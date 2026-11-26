-- Gateway protections and server-only RPC wrappers.
-- 1) Meeting links must not be readable through the Data API: otherwise an enrolled but unpaid student could
--    skip the join gateway. Column privileges hide them; the server (service_role) reads them at join time.
do $$
declare cols text;
begin
  revoke select on public.sessions from authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'sessions'
      and column_name not in ('meeting_url', 'external_meeting_id');
  execute format('grant select (%s) on public.sessions to authenticated', cols);

  revoke select on public.classes from authenticated;
  select string_agg(quote_ident(column_name), ', ') into cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'classes' and column_name <> 'meeting_url';
  execute format('grant select (%s) on public.classes to authenticated', cols);
end $$;

-- 2) Single-use join tokens (random, stored as hash, valid for minutes).
create table private.join_tokens (
  token_hash bytea primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index join_tokens_session_idx on private.join_tokens (session_id);
create index join_tokens_org_idx on private.join_tokens (org_id);
create index join_tokens_student_idx on private.join_tokens (student_id);
alter table private.join_tokens enable row level security;
grant all on private.join_tokens to service_role;

-- 3) Wrappers. The Data API can only call functions in exposed schemas, so thin public wrappers expose the
--    private logic to service_role and to nobody else.
create function public.rpc_check_join(p_student uuid, p_session uuid) returns text
language sql security invoker set search_path = '' as $$ select private.check_join(p_student, p_session) $$;

create function public.rpc_confirm_payment(p_intent uuid, p_receipt text, p_amount numeric, p_phone text,
  p_link_token_hash bytea, p_code_hash bytea) returns uuid
language sql security invoker set search_path = '' as
$$ select private.confirm_payment(p_intent, p_receipt, p_amount, p_phone, p_link_token_hash, p_code_hash) $$;

create function public.rpc_apply_override(p_actor uuid, p_session uuid, p_enrollment uuid,
  p_status public.attendance_status, p_reason text) returns uuid
language sql security invoker set search_path = '' as
$$ select private.apply_override(p_actor, p_session, p_enrollment, p_status, p_reason) $$;

create function public.rpc_compute_attendance(p_session uuid, p_enrollment uuid) returns public.attendance_records
language sql security invoker set search_path = '' as $$ select * from private.compute_attendance(p_session, p_enrollment) $$;

create function public.rpc_audit(p_org uuid, p_actor uuid, p_action text, p_entity text, p_entity_id text,
  p_old jsonb, p_new jsonb, p_reason text, p_source text) returns void
language sql security invoker set search_path = '' as
$$ select private.write_audit(p_org, p_actor, p_action, p_entity, p_entity_id, p_old, p_new, p_reason, p_source) $$;

-- Per-session rotating-code secret, created on first use. Returned hex-encoded.
create function public.rpc_session_secret(p_session uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare v text;
begin
  insert into private.session_secrets (session_id) values (p_session) on conflict do nothing;
  select encode(secret, 'hex') into v from private.session_secrets where session_id = p_session;
  return v;
end $$;

-- Meeting link, read only by the server after every check has passed.
create function public.rpc_meeting_url(p_session uuid) returns text
language sql security invoker set search_path = '' as $$
  select coalesce(s.meeting_url, c.meeting_url) from public.sessions s
  join public.classes c on c.id = s.class_id where s.id = p_session $$;

-- Device binding: first device becomes active; any other creates a pending request for the teacher.
create function public.rpc_register_device(p_user uuid, p_token_hash bytea, p_label text) returns text
language plpgsql security invoker set search_path = '' as $$
declare v text;
begin
  select status into v from private.devices where user_id = p_user and token_hash = p_token_hash;
  if v is not null then return v; end if;
  if exists (select 1 from private.devices where user_id = p_user and status = 'active') then
    insert into private.devices (user_id, token_hash, label, status) values (p_user, p_token_hash, p_label, 'pending');
    return 'pending';
  end if;
  insert into private.devices (user_id, token_hash, label, status) values (p_user, p_token_hash, p_label, 'active');
  return 'active';
end $$;

create function public.rpc_device_status(p_user uuid, p_token_hash bytea) returns text
language sql security invoker set search_path = '' as $$
  select coalesce((select status from private.devices where user_id = p_user and token_hash = p_token_hash), 'unknown') $$;

-- Record evidence for a student in a session. Returns the enrolment id, or null if not enrolled.
create function public.rpc_record_event(p_session uuid, p_student uuid, p_type public.event_type, p_meta jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.sessions; v_enr uuid;
begin
  select * into s from public.sessions where id = p_session;
  if not found then return null; end if;
  select id into v_enr from public.enrollments
    where class_id = s.class_id and student_id = p_student and status = 'approved';
  if v_enr is null then return null; end if;
  insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type, meta)
  values (s.org_id, p_session, v_enr, p_student, p_type, coalesce(p_meta, '{}'));
  return v_enr;
end $$;

create function public.rpc_mint_join_token(p_session uuid, p_student uuid, p_token_hash bytea, p_minutes int)
returns void language sql security invoker set search_path = '' as $$
  insert into private.join_tokens (token_hash, org_id, session_id, student_id, expires_at)
  select p_token_hash, s.org_id, s.id, p_student, now() + make_interval(mins => p_minutes)
  from public.sessions s where s.id = p_session $$;

-- Consumes a token exactly once; returns the meeting url, or null if unknown, used or expired.
create function public.rpc_consume_join_token(p_token_hash bytea, p_student uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare t private.join_tokens;
begin
  update private.join_tokens set used_at = now()
    where token_hash = p_token_hash and student_id = p_student and used_at is null and expires_at > now()
    returning * into t;
  if not found then return null; end if;
  return public.rpc_meeting_url(t.session_id);
end $$;

-- Payment intents.
create function public.rpc_create_intent(p_payer uuid, p_beneficiary uuid, p_fee_plan uuid, p_phone text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.fee_plans; v_id uuid;
begin
  select * into f from public.fee_plans where id = p_fee_plan and active;
  if not found then raise exception 'unknown fee plan'; end if;
  insert into private.payment_intents (org_id, payer_id, beneficiary_id, fee_plan_id, phone, amount)
  values (f.org_id, p_payer, p_beneficiary, f.id, p_phone, f.amount) returning id into v_id;
  return jsonb_build_object('id', v_id, 'amount', f.amount, 'org_id', f.org_id);
end $$;

create function public.rpc_set_checkout(p_intent uuid, p_checkout text, p_merchant text) returns void
language sql security invoker set search_path = '' as $$
  update private.payment_intents set checkout_request_id = p_checkout, merchant_request_id = p_merchant where id = p_intent $$;

create function public.rpc_intent_by_checkout(p_checkout text) returns jsonb
language sql security invoker set search_path = '' as $$
  select to_jsonb(i) from private.payment_intents i where i.checkout_request_id = p_checkout $$;

create function public.rpc_fail_intent(p_intent uuid) returns void
language sql security invoker set search_path = '' as
$$ update private.payment_intents set status = 'failed' where id = p_intent and status = 'pending' $$;

-- Only service_role may call any wrapper.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rpc_check_join(uuid, uuid), public.rpc_confirm_payment(uuid, text, numeric, text, bytea, bytea),
  public.rpc_apply_override(uuid, uuid, uuid, public.attendance_status, text),
  public.rpc_compute_attendance(uuid, uuid),
  public.rpc_audit(uuid, uuid, text, text, text, jsonb, jsonb, text, text),
  public.rpc_session_secret(uuid), public.rpc_meeting_url(uuid),
  public.rpc_register_device(uuid, bytea, text), public.rpc_device_status(uuid, bytea),
  public.rpc_record_event(uuid, uuid, public.event_type, jsonb),
  public.rpc_mint_join_token(uuid, uuid, bytea, int), public.rpc_consume_join_token(bytea, uuid),
  public.rpc_create_intent(uuid, uuid, uuid, text), public.rpc_set_checkout(uuid, text, text),
  public.rpc_intent_by_checkout(text), public.rpc_fail_intent(uuid)
  to service_role;

-- Audit chain wrappers (daily digest job).
create function public.rpc_verify_audit_chain() returns bigint
language sql security invoker set search_path = '' as $$ select private.verify_audit_chain() $$;
create function public.rpc_latest_audit_hash() returns jsonb
language sql security invoker set search_path = '' as
$$ select to_jsonb(a) from (select id, hash from private.audit_log order by id desc limit 1) a $$;

-- Pending devices visible to a teacher/admin who has authority over the student.
create function private.can_manage_student(p_actor uuid, p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m where m.user_id = p_actor and m.status = 'active' and m.role = 'system_admin'
    union all
    select 1 from public.memberships m
      join public.memberships sm on sm.org_id = m.org_id and sm.user_id = p_student and sm.role = 'student'
      where m.user_id = p_actor and m.status = 'active' and m.role = 'school_admin'
    union all
    select 1 from public.class_staff cs
      join public.enrollments e on e.class_id = cs.class_id and e.student_id = p_student and e.status = 'approved'
      where cs.user_id = p_actor and cs.role = 'teacher');
$$;

create function public.rpc_pending_devices(p_actor uuid) returns table (device_id uuid, student_id uuid, label text, requested_at timestamptz)
language sql security invoker set search_path = '' as $$
  select d.id, d.user_id, d.label, d.created_at from private.devices d
  where d.status = 'pending' and private.can_manage_student(p_actor, d.user_id) order by d.created_at $$;

-- Approving a pending device swaps it in as the single active device, with an audit entry.
create function public.rpc_approve_device(p_actor uuid, p_device uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare d private.devices; v_org uuid;
begin
  select * into d from private.devices where id = p_device and status = 'pending' for update;
  if not found then raise exception 'no such pending device'; end if;
  if not private.can_manage_student(p_actor, d.user_id) then
    raise exception 'not allowed to approve this device' using errcode = '42501';
  end if;
  update private.devices set status = 'revoked' where user_id = d.user_id and status = 'active';
  update private.devices set status = 'active', approved_by = p_actor where id = p_device;
  select org_id into v_org from public.memberships where user_id = d.user_id and role = 'student' and org_id is not null limit 1;
  perform private.write_audit(v_org, p_actor, 'device.approved', 'device', p_device::text, null,
    jsonb_build_object('student', d.user_id), null, 'teacher');
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.rpc_verify_audit_chain(), public.rpc_latest_audit_hash(),
  public.rpc_pending_devices(uuid), public.rpc_approve_device(uuid, uuid) to service_role;
revoke execute on function private.can_manage_student(uuid, uuid) from public, anon, authenticated;
grant execute on function private.can_manage_student(uuid, uuid) to service_role;

-- Intents still waiting for a callback (reconciliation job).
create function public.rpc_pending_intents(p_older_than_seconds int) returns table (id uuid, org_id uuid, checkout_request_id text)
language sql security invoker set search_path = '' as $$
  select i.id, i.org_id, i.checkout_request_id from private.payment_intents i
  where i.status = 'pending' and i.checkout_request_id is not null
    and i.created_at < now() - make_interval(secs => p_older_than_seconds)
    and i.created_at > now() - interval '1 day' order by i.created_at limit 100 $$;
revoke execute on function public.rpc_pending_intents(int) from public, anon, authenticated;
grant execute on function public.rpc_pending_intents(int) to service_role;

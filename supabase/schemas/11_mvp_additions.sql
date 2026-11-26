-- MVP additions: sign-up profile and consent, notifications with a retrying outbox, connection-problem claims,
-- access-link redemption, and class / fee plan / timetable setup. Everything here is server-only and audited.

alter table public.profiles add column guardian_name text, add column guardian_phone text;
alter table public.notifications add column dedupe_key text unique;
alter table private.outbox add column last_error text;

-- ---------- sign-up profile ----------
create function public.rpc_complete_profile(p_user uuid, p_full_name text, p_phone text, p_email text, p_admission text,
  p_upi text, p_is_minor boolean, p_guardian_name text, p_guardian_phone text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_phone is null or p_phone !~ '^\+254[0-9]{9}$' then raise exception 'phone must be +254 format' using errcode = '22023'; end if;
  if p_is_minor and (coalesce(btrim(p_guardian_name), '') = '' or p_guardian_phone is null or p_guardian_phone !~ '^\+254[0-9]{9}$') then
    raise exception 'guardian name and phone are required for under-18s' using errcode = '22023'; end if;
  if not p_is_minor and coalesce(btrim(p_email), '') = '' then raise exception 'email is required for adults' using errcode = '22023'; end if;
  insert into public.profiles (id, full_name, phone, email, admission_no, learner_upi, is_minor, guardian_name, guardian_phone)
  values (p_user, btrim(p_full_name), p_phone, nullif(btrim(p_email), ''), nullif(btrim(p_admission), ''), nullif(btrim(p_upi), ''),
          p_is_minor, case when p_is_minor then btrim(p_guardian_name) end, case when p_is_minor then p_guardian_phone end)
  on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
    admission_no = excluded.admission_no, learner_upi = excluded.learner_upi, is_minor = excluded.is_minor,
    guardian_name = excluded.guardian_name, guardian_phone = excluded.guardian_phone;
end $$;

create function public.rpc_record_consent(p_user uuid, p_org uuid, p_kind text, p_version text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_kind not in ('terms', 'guardian', 'selfie') then raise exception 'bad consent kind' using errcode = '22023'; end if;
  insert into public.consents (org_id, user_id, kind, terms_version, granted_by) values (p_org, p_user, p_kind, p_version, p_user);
  perform private.write_audit(p_org, p_user, 'consent.recorded', 'consent', p_user::text, null,
    jsonb_build_object('kind', p_kind, 'version', p_version), null, 'student');
end $$;

-- Redeeming an invitation now needs terms consent, and guardian consent for under-18s, recorded for that school.
create or replace function public.rpc_redeem_invitation(p_student uuid, p_token_hash bytea) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare i private.invitations; v_enr uuid; v_minor boolean;
begin
  select * into i from private.invitations where token_hash = p_token_hash and expires_at > now();
  if not found then return null; end if;
  if not exists (select 1 from public.organizations where id = i.org_id and status = 'approved') then return null; end if;
  select is_minor into v_minor from public.profiles where id = p_student;
  if v_minor is null then raise exception 'profile_required' using errcode = '22023'; end if;
  if not exists (select 1 from public.consents where user_id = p_student and org_id = i.org_id and kind = 'terms')
     or (v_minor and not exists (select 1 from public.consents where user_id = p_student and org_id = i.org_id and kind = 'guardian')) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  insert into public.memberships (user_id, org_id, role, status) values (p_student, i.org_id, 'student', 'active')
    on conflict (user_id, org_id, role) do nothing;
  insert into public.enrollments (org_id, class_id, student_id, status) values (i.org_id, i.class_id, p_student, 'requested')
    on conflict (class_id, student_id) do nothing returning id into v_enr;
  if v_enr is null then select id into v_enr from public.enrollments where class_id = i.class_id and student_id = p_student; end if;
  perform private.write_audit(i.org_id, p_student, 'enrollment.requested', 'enrollment', v_enr::text, null,
    jsonb_build_object('class', i.class_id, 'via', 'invitation'), null, 'student');
  return v_enr;
end $$;

-- Which school an invitation belongs to (so the join page can ask for the right consent).
create function public.rpc_invitation_org(p_token_hash bytea) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('org_id', i.org_id, 'org_name', o.name, 'class_name', c.name)
  from private.invitations i join public.organizations o on o.id = i.org_id join public.classes c on c.id = i.class_id
  where i.token_hash = p_token_hash and i.expires_at > now() $$;

-- ---------- notifications and outbox ----------
create function private.notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_critical boolean,
  p_channels text[], p_dedupe text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; prefs public.notification_prefs; v_email text; s record;
begin
  insert into public.notifications (org_id, user_id, kind, title, body, critical, dedupe_key)
  values (p_org, p_user, p_kind, p_title, p_body, p_critical, p_dedupe)
  on conflict (dedupe_key) do nothing returning id into v_id;
  if v_id is null then return null; end if;                       -- already sent once
  select * into prefs from public.notification_prefs where user_id = p_user;
  -- Payment, security and attendance-change notices (critical) cannot be switched off.
  if 'email' = any(p_channels) and (p_critical or coalesce(prefs.email, true)) then
    select email into v_email from public.profiles where id = p_user;
    if v_email is not null then
      insert into private.outbox (notification_id, channel, recipient, payload)
      values (v_id, 'email', v_email, jsonb_build_object('title', p_title, 'body', p_body));
    end if;
  end if;
  if 'push' = any(p_channels) and (p_critical or coalesce(prefs.push, true)) then
    for s in select endpoint, p256dh, auth from public.push_subscriptions where user_id = p_user loop
      insert into private.outbox (notification_id, channel, recipient, payload)
      values (v_id, 'push', s.endpoint, jsonb_build_object('title', p_title, 'body', p_body, 'url', '/dashboard', 'p256dh', s.p256dh, 'auth', s.auth));
    end loop;
  end if;
  return v_id;
end $$;

create function public.rpc_notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_critical boolean,
  p_channels text[], p_dedupe text) returns uuid
language sql security invoker set search_path = '' as
$$ select private.notify(p_user, p_org, p_kind, p_title, p_body, p_critical, p_channels, p_dedupe) $$;

-- Claim a batch for sending. The lease (next_attempt_at +2 min) stops two workers sending the same row.
create function public.rpc_claim_outbox(p_limit int) returns setof private.outbox
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  update private.outbox o set attempts = o.attempts + 1, next_attempt_at = now() + interval '2 minutes'
  where o.id in (select id from private.outbox where status = 'waiting' and next_attempt_at <= now()
                 order by id limit p_limit for update skip locked)
  returning o.*;
end $$;

create function public.rpc_outbox_result(p_id bigint, p_sent boolean, p_permanent boolean, p_retry_seconds int, p_error text) returns void
language sql security invoker set search_path = '' as $$
  update private.outbox set
    status = case when p_sent then 'sent' when p_permanent then 'permanent_failure' else 'waiting' end,
    next_attempt_at = now() + make_interval(secs => coalesce(p_retry_seconds, 0)),
    last_error = case when p_sent then null else left(p_error, 300) end
  where id = p_id $$;

create function public.rpc_drop_push_endpoint(p_endpoint text) returns void
language sql security invoker set search_path = '' as $$ delete from public.push_subscriptions where endpoint = p_endpoint $$;

create function public.rpc_outbox_backlog() returns bigint
language sql security invoker set search_path = '' as
$$ select count(*) from private.outbox where status = 'waiting' and created_at < now() - interval '10 minutes' $$;

-- ---------- connection-problem claims ----------
create function public.rpc_submit_claim(p_student uuid, p_session uuid, p_note text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare s public.sessions; v_enr uuid; v_id uuid; r record;
begin
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'unknown session' using errcode = '22023'; end if;
  select id into v_enr from public.enrollments where class_id = s.class_id and student_id = p_student and status = 'approved';
  if v_enr is null then raise exception 'not enrolled' using errcode = '42501'; end if;
  if now() < s.ends_at or now() > s.ends_at + interval '7 days' then
    raise exception 'claims open after the session and for 7 days' using errcode = '22023'; end if;
  if exists (select 1 from public.connection_claims where session_id = p_session and enrollment_id = v_enr and status = 'pending') then
    raise exception 'a claim is already pending' using errcode = '23505'; end if;
  insert into public.connection_claims (org_id, session_id, enrollment_id, student_id, note)
  values (s.org_id, p_session, v_enr, p_student, btrim(p_note)) returning id into v_id;
  insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type, meta)
  values (s.org_id, p_session, v_enr, p_student, 'claim_submitted', jsonb_build_object('claim', v_id));
  perform private.compute_attendance(p_session, v_enr);              -- an open claim moves the record to pending review
  perform private.write_audit(s.org_id, p_student, 'claim.submitted', 'connection_claim', v_id::text, null,
    jsonb_build_object('session', p_session), null, 'student');
  for r in select user_id from public.class_staff where class_id = s.class_id and role = 'teacher' loop
    perform private.notify(r.user_id, s.org_id, 'claim.submitted', 'Connection-problem request',
      'A student asked for a review of "' || s.title || '".', false, array['email'], 'claim:' || v_id || ':' || r.user_id);
  end loop;
  return v_id;
end $$;

create function public.rpc_pending_claims(p_actor uuid)
returns table (claim_id uuid, session_id uuid, session_title text, class_name text, student_name text, note text,
               current_status public.attendance_status, created_at timestamptz)
language sql security invoker set search_path = '' as $$
  select k.id, k.session_id, s.title, c.name, p.full_name, k.note, r.effective_status, k.created_at
  from public.connection_claims k
  join public.sessions s on s.id = k.session_id join public.classes c on c.id = s.class_id
  join public.profiles p on p.id = k.student_id
  left join public.attendance_records r on r.session_id = k.session_id and r.enrollment_id = k.enrollment_id
  where k.status = 'pending' and private.actor_manages_class(p_actor, s.class_id, true) order by k.created_at $$;

create function public.rpc_decide_claim(p_actor uuid, p_claim uuid, p_approve boolean, p_status public.attendance_status, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
declare k public.connection_claims; s public.sessions;
begin
  select * into k from public.connection_claims where id = p_claim and status = 'pending' for update;
  if not found then raise exception 'no pending claim'; end if;
  select * into s from public.sessions where id = k.session_id;
  if not private.actor_manages_class(p_actor, s.class_id, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if p_approve then
    if p_status is null then raise exception 'status required' using errcode = '22023'; end if;
    perform private.apply_override(p_actor, k.session_id, k.enrollment_id, p_status, 'Connection claim approved: ' || p_reason);
  end if;
  update public.connection_claims set status = case when p_approve then 'approved' else 'rejected' end::public.claim_status,
    decided_by = p_actor where id = p_claim;
  perform private.compute_attendance(k.session_id, k.enrollment_id);   -- an overridden record keeps its override on top
  perform private.write_audit(k.org_id, p_actor, case when p_approve then 'claim.approved' else 'claim.rejected' end,
    'connection_claim', p_claim::text, jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end), p_reason, 'teacher');
  perform private.notify(k.student_id, k.org_id, 'claim.decided', 'Your request was ' || case when p_approve then 'approved' else 'declined' end,
    'Session "' || s.title || '": ' || p_reason, true, array['email', 'push'], 'claimdec:' || p_claim);
end $$;

-- ---------- access pack ----------
create function public.rpc_open_access_link(p_student uuid, p_token_hash bytea) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('class_id', e.class_id, 'class_name', c.name, 'valid_until', e.valid_until)
  from private.access_credentials a join public.entitlements e on e.id = a.entitlement_id
  join public.classes c on c.id = e.class_id
  where a.link_token_hash = p_token_hash and e.student_id = p_student and e.status = 'active' $$;   -- only the beneficiary

create function public.rpc_verify_access_code(p_student uuid, p_code_hash bytea) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('class_id', e.class_id, 'class_name', c.name)
  from private.access_credentials a join public.entitlements e on e.id = a.entitlement_id
  join public.classes c on c.id = e.class_id
  where a.code_hash = p_code_hash and e.student_id = p_student and e.status = 'active' limit 1 $$;

-- ---------- class, fee plan, timetable setup ----------
create unique index sessions_class_slot_uniq on public.sessions (class_id, starts_at);   -- a class never has two sessions at one instant

create function public.rpc_create_class(p_actor uuid, p_org uuid, p_name text, p_type text, p_provider text, p_meeting_url text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_teacher boolean; v_admin boolean;
begin
  select exists (select 1 from public.memberships where user_id = p_actor and status = 'active' and (role = 'system_admin' or (org_id = p_org and role = 'school_admin'))) into v_admin;
  select exists (select 1 from public.memberships where user_id = p_actor and status = 'active' and org_id = p_org and role = 'teacher') into v_teacher;
  if not (v_admin or v_teacher) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.classes (org_id, name, class_type, meeting_provider, meeting_url, created_by)
  values (p_org, btrim(p_name), p_type, p_provider, nullif(p_meeting_url, ''), p_actor) returning id into v_id;
  if v_teacher then insert into public.class_staff (class_id, user_id, org_id, role) values (v_id, p_actor, p_org, 'teacher'); end if;
  perform private.write_audit(p_org, p_actor, 'class.created', 'class', v_id::text, null, jsonb_build_object('name', p_name), null, 'teacher');
  return v_id;
end $$;

create function public.rpc_assign_teacher(p_actor uuid, p_class uuid, p_teacher uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  if not private.actor_manages_class(p_actor, p_class, false) then raise exception 'not allowed' using errcode = '42501'; end if;
  select org_id into v_org from public.classes where id = p_class;
  if not exists (select 1 from public.memberships where user_id = p_teacher and org_id = v_org and role = 'teacher' and status = 'active') then
    raise exception 'that person is not a teacher at this school' using errcode = '22023'; end if;
  insert into public.class_staff (class_id, user_id, org_id, role) values (p_class, p_teacher, v_org, 'teacher') on conflict do nothing;
  perform private.write_audit(v_org, p_actor, 'class.teacher_assigned', 'class', p_class::text, null, jsonb_build_object('teacher', p_teacher), null, 'admin');
end $$;

create function public.rpc_create_fee_plan(p_actor uuid, p_class uuid, p_kind text, p_name text, p_amount numeric, p_sessions int) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_id uuid;
begin
  if not private.actor_manages_class(p_actor, p_class, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  select org_id into v_org from public.classes where id = p_class;
  insert into public.fee_plans (org_id, class_id, kind, name, amount, sessions_covered)
  values (v_org, p_class, p_kind, btrim(p_name), p_amount, p_sessions) returning id into v_id;
  perform private.write_audit(v_org, p_actor, 'fee_plan.created', 'fee_plan', v_id::text, null, jsonb_build_object('amount', p_amount, 'kind', p_kind), null, 'teacher');
  return v_id;
end $$;

create function public.rpc_create_holiday(p_actor uuid, p_org uuid, p_name text, p_from date, p_to date) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.memberships where user_id = p_actor and status = 'active' and (role = 'system_admin' or (org_id = p_org and role = 'school_admin'))) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.holidays (org_id, name, starts_on, ends_on) values (p_org, btrim(p_name), p_from, p_to) returning id into v_id;
  perform private.write_audit(p_org, p_actor, 'holiday.created', 'holiday', v_id::text, null, jsonb_build_object('from', p_from, 'to', p_to), null, 'admin');
  return v_id;
end $$;

-- A timetable plus its generated sessions, in East Africa Time, skipping the school's holidays. Safe to run twice.
create function public.rpc_create_timetable(p_actor uuid, p_class uuid, p_weekday int, p_start time, p_end time,
  p_from date, p_to date, p_title text) returns int
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_tt uuid; v_n int;
begin
  if not private.actor_manages_class(p_actor, p_class, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to - p_from > 400 then raise exception 'range too long' using errcode = '22023'; end if;
  select org_id into v_org from public.classes where id = p_class;
  select id into v_tt from public.timetables where class_id = p_class and weekday = p_weekday and start_time = p_start
    and end_time = p_end and starts_on = p_from and ends_on = p_to;
  if v_tt is null then
    insert into public.timetables (org_id, class_id, weekday, start_time, end_time, starts_on, ends_on)
    values (v_org, p_class, p_weekday, p_start, p_end, p_from, p_to) returning id into v_tt;
  end if;
  insert into public.sessions (org_id, class_id, timetable_id, title, starts_at, ends_at)
  select v_org, p_class, v_tt, btrim(p_title), (d::date + p_start) at time zone 'Africa/Nairobi', (d::date + p_end) at time zone 'Africa/Nairobi'
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  where extract(isodow from d) = p_weekday
    and not exists (select 1 from public.holidays h where h.org_id = v_org and d::date between h.starts_on and h.ends_on)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  perform private.write_audit(v_org, p_actor, 'timetable.created', 'timetable', v_tt::text, null, jsonb_build_object('sessions', v_n), null, 'teacher');
  return v_n;
end $$;

create function public.rpc_cancel_session(p_actor uuid, p_session uuid, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.sessions; r record;
begin
  select * into s from public.sessions where id = p_session and status = 'scheduled' for update;
  if not found then raise exception 'only scheduled sessions can be cancelled' using errcode = '22023'; end if;
  if not private.actor_manages_class(p_actor, s.class_id, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.sessions set status = 'cancelled' where id = p_session;
  perform private.write_audit(s.org_id, p_actor, 'session.cancelled', 'session', p_session::text, jsonb_build_object('status', 'scheduled'),
    jsonb_build_object('status', 'cancelled'), p_reason, 'teacher');
  for r in select student_id from public.enrollments where class_id = s.class_id and status = 'approved' loop
    perform private.notify(r.student_id, s.org_id, 'session.cancelled', 'Session cancelled', '"' || s.title || '" was cancelled. ' || coalesce(p_reason, ''),
      false, array['push'], 'cancel:' || p_session || ':' || r.student_id);
  end loop;
end $$;

-- ---------- lock-down ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rpc_complete_profile(uuid, text, text, text, text, text, boolean, text, text), public.rpc_record_consent(uuid, uuid, text, text),
  public.rpc_invitation_org(bytea),
  public.rpc_notify(uuid, uuid, text, text, text, boolean, text[], text), public.rpc_claim_outbox(int),
  public.rpc_outbox_result(bigint, boolean, boolean, int, text), public.rpc_drop_push_endpoint(text), public.rpc_outbox_backlog(),
  public.rpc_submit_claim(uuid, uuid, text), public.rpc_pending_claims(uuid),
  public.rpc_decide_claim(uuid, uuid, boolean, public.attendance_status, text),
  public.rpc_open_access_link(uuid, bytea), public.rpc_verify_access_code(uuid, bytea),
  public.rpc_create_class(uuid, uuid, text, text, text, text), public.rpc_assign_teacher(uuid, uuid, uuid),
  public.rpc_create_fee_plan(uuid, uuid, text, text, numeric, int), public.rpc_create_holiday(uuid, uuid, text, date, date),
  public.rpc_create_timetable(uuid, uuid, int, time, time, date, date, text), public.rpc_cancel_session(uuid, uuid, text),
  public.rpc_redeem_invitation(uuid, bytea) to service_role;
revoke execute on function private.notify(uuid, uuid, text, text, text, boolean, text[], text) from public, anon, authenticated;
grant execute on function private.notify(uuid, uuid, text, text, text, boolean, text[], text) to service_role;

-- Commission percentage for a school (private table), used only by the payments report.
create function public.rpc_commission_percent(p_org uuid) returns numeric
language sql security invoker set search_path = '' as $$
  select coalesce((select percent from private.commission_rules where org_id = p_org order by effective_from desc limit 1),
                  (select percent from private.commission_rules where org_id is null order by effective_from desc limit 1)) $$;
revoke execute on function public.rpc_commission_percent(uuid) from public, anon, authenticated;
grant execute on function public.rpc_commission_percent(uuid) to service_role;

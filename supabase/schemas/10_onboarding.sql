-- Onboarding: invitation links, enrolment approval queue, free-access grants. All server-only, all audited.
create table private.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index invitations_org_idx on private.invitations (org_id);
create index invitations_class_idx on private.invitations (class_id);
create index invitations_created_by_idx on private.invitations (created_by);
alter table private.invitations enable row level security;
grant all on private.invitations to service_role;

-- Authority helpers take the actor explicitly (the server calls them as service_role, so auth.uid() is empty).
create function private.actor_manages_class(p_actor uuid, p_class uuid, p_teacher_ok boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m where m.user_id = p_actor and m.status = 'active' and m.role = 'system_admin'
    union all
    select 1 from public.classes c join public.memberships m on m.org_id = c.org_id and m.user_id = p_actor
      and m.status = 'active' and m.role = 'school_admin' where c.id = p_class
    union all
    select 1 from public.class_staff cs where p_teacher_ok and cs.class_id = p_class and cs.user_id = p_actor and cs.role = 'teacher');
$$;

create function public.rpc_create_invitation(p_actor uuid, p_class uuid, p_token_hash bytea, p_days int) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_org uuid;
begin
  if p_days not between 1 and 90 then raise exception 'invalid expiry' using errcode = '22023'; end if;
  if not private.actor_manages_class(p_actor, p_class, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  select org_id into v_org from public.classes where id = p_class;
  insert into private.invitations (org_id, class_id, token_hash, expires_at, created_by)
  values (v_org, p_class, p_token_hash, now() + make_interval(days => p_days), p_actor);
  perform private.write_audit(v_org, p_actor, 'invitation.created', 'class', p_class::text, null, jsonb_build_object('days', p_days), null, 'teacher');
end $$;

-- Anyone signed in who opens a valid link may REQUEST to join. Approval and payment still follow.
create function public.rpc_redeem_invitation(p_student uuid, p_token_hash bytea) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare i private.invitations; v_enr uuid;
begin
  select * into i from private.invitations where token_hash = p_token_hash and expires_at > now();
  if not found then return null; end if;
  if not exists (select 1 from public.organizations where id = i.org_id and status = 'approved') then return null; end if;
  insert into public.memberships (user_id, org_id, role, status) values (p_student, i.org_id, 'student', 'active')
    on conflict (user_id, org_id, role) do nothing;
  insert into public.enrollments (org_id, class_id, student_id, status) values (i.org_id, i.class_id, p_student, 'requested')
    on conflict (class_id, student_id) do nothing returning id into v_enr;
  if v_enr is null then select id into v_enr from public.enrollments where class_id = i.class_id and student_id = p_student; end if;
  perform private.write_audit(i.org_id, p_student, 'enrollment.requested', 'enrollment', v_enr::text, null,
    jsonb_build_object('class', i.class_id, 'via', 'invitation'), null, 'student');
  return v_enr;
end $$;

create function public.rpc_pending_enrollments(p_actor uuid)
returns table (enrollment_id uuid, class_id uuid, class_name text, student_id uuid, student_name text, admission_no text, requested_at timestamptz)
language sql security invoker set search_path = '' as $$
  select e.id, e.class_id, c.name, e.student_id, p.full_name, p.admission_no, e.created_at
  from public.enrollments e join public.classes c on c.id = e.class_id join public.profiles p on p.id = e.student_id
  where e.status = 'requested' and private.actor_manages_class(p_actor, e.class_id, true) order by e.created_at $$;

create function public.rpc_decide_enrollment(p_actor uuid, p_enrollment uuid, p_approve boolean) returns void
language plpgsql security invoker set search_path = '' as $$
declare e public.enrollments;
begin
  select * into e from public.enrollments where id = p_enrollment and status = 'requested' for update;
  if not found then raise exception 'no pending request'; end if;
  if not private.actor_manages_class(p_actor, e.class_id, true) then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.enrollments set status = case when p_approve then 'approved' else 'removed' end::public.enrollment_status,
    approved_by = p_actor where id = p_enrollment;
  perform private.write_audit(e.org_id, p_actor, case when p_approve then 'enrollment.approved' else 'enrollment.declined' end,
    'enrollment', p_enrollment::text, jsonb_build_object('status', 'requested'),
    jsonb_build_object('status', case when p_approve then 'approved' else 'removed' end), null, 'teacher');
end $$;

-- Free access (scholarship, staff, trial, sponsored, late_payment). School admin or system admin only; reason required.
create function public.rpc_grant_exemption(p_actor uuid, p_class uuid, p_student uuid, p_kind text, p_reason text, p_days int)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_ex uuid; v_ent uuid; v_until timestamptz;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = '22023'; end if;
  if p_kind = 'late_payment' and not exists (select 1 from public.memberships where user_id = p_actor and role = 'system_admin' and status = 'active') then
    raise exception 'late payment needs system admin approval' using errcode = '42501';
  end if;
  if not private.actor_manages_class(p_actor, p_class, false) then raise exception 'not allowed' using errcode = '42501'; end if;
  select org_id into v_org from public.classes where id = p_class;
  if not exists (select 1 from public.enrollments where class_id = p_class and student_id = p_student and status = 'approved') then
    raise exception 'student is not approved in this class' using errcode = '22023';
  end if;
  v_until := case when p_days is null then null else now() + make_interval(days => p_days) end;
  insert into public.exemptions (org_id, class_id, student_id, reason, kind, granted_by, expires_at)
  values (v_org, p_class, p_student, p_reason, p_kind, p_actor, v_until) returning id into v_ex;
  insert into public.entitlements (org_id, class_id, student_id, exemption_id, valid_until)
  values (v_org, p_class, p_student, v_ex, v_until) returning id into v_ent;
  perform private.write_audit(v_org, p_actor, 'exemption.granted', 'exemption', v_ex::text, null,
    jsonb_build_object('student', p_student, 'kind', p_kind, 'entitlement', v_ent), p_reason, 'admin');
  return v_ent;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.rpc_create_invitation(uuid, uuid, bytea, int), public.rpc_redeem_invitation(uuid, bytea),
  public.rpc_pending_enrollments(uuid), public.rpc_decide_enrollment(uuid, uuid, boolean),
  public.rpc_grant_exemption(uuid, uuid, uuid, text, text, int) to service_role;
revoke execute on function private.actor_manages_class(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function private.actor_manages_class(uuid, uuid, boolean) to service_role;

-- Small read helper used by tests and the audit viewer's counters.
create function public.rpc_audit_count_like(p_action text) returns bigint
language sql security invoker set search_path = '' as $$ select count(*) from private.audit_log where action = p_action $$;
revoke execute on function public.rpc_audit_count_like(text) from public, anon, authenticated;
grant execute on function public.rpc_audit_count_like(text) to service_role;

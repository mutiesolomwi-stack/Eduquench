create table public.attendance_windows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  opened_by uuid not null references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index attendance_windows_org_idx on public.attendance_windows (org_id);
create index attendance_windows_open_idx on public.attendance_windows (session_id) where closed_at is null;

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  computed_status public.attendance_status not null,
  effective_status public.attendance_status not null,   -- override if any, else computed (computed is always kept)
  seconds_present int not null default 0,
  late_minutes int not null default 0,
  early_minutes int not null default 0,
  checks_sent int not null default 0,
  checks_passed int not null default 0,
  confidence public.confidence_level not null default 'low',
  computed_at timestamptz not null default now(),
  unique (session_id, enrollment_id)
);
create index attendance_records_org_idx on public.attendance_records (org_id);
create index attendance_records_student_idx on public.attendance_records (student_id);
create index attendance_records_enrollment_idx on public.attendance_records (enrollment_id);

-- Append-only evidence.
create table public.attendance_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  type public.event_type not null,
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'
);
create index attendance_events_session_enrollment_idx on public.attendance_events (session_id, enrollment_id, occurred_at);
create index attendance_events_org_idx on public.attendance_events (org_id);
create index attendance_events_student_idx on public.attendance_events (student_id);
create index attendance_events_enrollment_idx on public.attendance_events (enrollment_id);

create function private.reject_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append-only table: % is not allowed on %.%', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $$;

create trigger attendance_events_no_change
  before update or delete on public.attendance_events
  for each row execute function private.reject_change();
create trigger attendance_events_no_truncate
  before truncate on public.attendance_events
  for each statement execute function private.reject_change();

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  type public.challenge_type not null default 'tap',
  due_at timestamptz not null,
  expires_at timestamptz not null,
  sent_at timestamptz,
  retried boolean not null default false,
  answered_at timestamptz,
  passed boolean,
  check (expires_at > due_at)
);
create index challenges_session_idx on public.challenges (session_id);
create index challenges_org_idx on public.challenges (org_id);
create index challenges_enrollment_idx on public.challenges (enrollment_id);
create index challenges_pending_idx on public.challenges (due_at) where answered_at is null;

create table public.connection_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (char_length(note) between 3 and 500),
  status public.claim_status not null default 'pending',
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index connection_claims_session_idx on public.connection_claims (session_id);
create index connection_claims_org_idx on public.connection_claims (org_id);
create index connection_claims_enrollment_idx on public.connection_claims (enrollment_id);
create index connection_claims_student_idx on public.connection_claims (student_id);

create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  status public.attendance_status not null,
  reason text not null check (char_length(btrim(reason)) >= 3),   -- a reason is mandatory
  author_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index overrides_session_idx on public.overrides (session_id, enrollment_id, created_at desc);
create index overrides_org_idx on public.overrides (org_id);
create index overrides_enrollment_idx on public.overrides (enrollment_id);

create table public.platform_participants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  account_email text, display_name text,
  joined_at timestamptz, left_at timestamptz,
  matched_student_id uuid references auth.users(id)
);
create index platform_participants_session_idx on public.platform_participants (session_id);
create index platform_participants_org_idx on public.platform_participants (org_id);

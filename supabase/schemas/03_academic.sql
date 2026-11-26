create table public.academic_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null,
  check (ends_on >= starts_on)
);
create index academic_periods_org_idx on public.academic_periods (org_id);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null
);
create index programs_org_idx on public.programs (org_id);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid references public.programs(id) on delete set null,
  period_id uuid references public.academic_periods(id) on delete set null,
  name text not null,
  class_type text not null default 'recurring'
    check (class_type in ('one_off','recurring','multi_week','bootcamp')),
  meeting_provider text not null default 'pasted_link'
    check (meeting_provider in ('google_meet','teams','zoom','pasted_link')),
  meeting_url text check (meeting_url is null or meeting_url ~ '^https://'),
  -- Teacher-defined "attended" rules; copied onto each session when it starts.
  rules jsonb not null default '{"min_presence_pct":75,"late_minutes":20,"early_minutes":20,"grace_minutes":10,"min_checks":2,"strict":true}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index classes_org_idx on public.classes (org_id);
create index classes_program_idx on public.classes (program_id);
create index classes_period_idx on public.classes (period_id);

create table public.class_staff (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('teacher','assistant')),
  primary key (class_id, user_id)
);
create index class_staff_user_idx on public.class_staff (user_id);
create index class_staff_org_idx on public.class_staff (org_id);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  status public.enrollment_status not null default 'requested',
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);
create index enrollments_org_idx on public.enrollments (org_id);
create index enrollments_student_idx on public.enrollments (student_id);

create table public.timetables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null, end_time time not null,
  starts_on date not null, ends_on date not null,
  check (end_time > start_time and ends_on >= starts_on)
);
create index timetables_class_idx on public.timetables (class_id);
create index timetables_org_idx on public.timetables (org_id);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, starts_on date not null, ends_on date not null
);
create index holidays_org_idx on public.holidays (org_id);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  timetable_id uuid references public.timetables(id) on delete set null,
  title text not null,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status public.session_status not null default 'scheduled',
  meeting_url text check (meeting_url is null or meeting_url ~ '^https://'),
  external_meeting_id text,
  frozen_rules jsonb,   -- set when the attendance window opens
  check (ends_at > starts_at)
);
create index sessions_class_idx on public.sessions (class_id, starts_at);
create index sessions_org_idx on public.sessions (org_id);
create index sessions_live_idx on public.sessions (starts_at) where status = 'live';

-- Per-session HMAC secret for the rotating code. Server only.
create table private.session_secrets (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  secret bytea not null default extensions.gen_random_bytes(32)
);

create function private.is_class_staff(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.classes c where c.id = p_class and (
      private.has_org_role(c.org_id, array['school_admin']::public.app_role[])
      or exists (select 1 from public.class_staff s
                 where s.class_id = c.id and s.user_id = (select auth.uid()))));
$$;

create function private.is_class_member(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_class_staff(p_class) or exists (
    select 1 from public.enrollments e
    where e.class_id = p_class and e.student_id = (select auth.uid()) and e.status = 'approved');
$$;

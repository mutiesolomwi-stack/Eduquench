create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  status public.org_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 200),
  phone text check (phone ~ '^\+254[0-9]{9}$'),
  email text,
  admission_no text,
  learner_upi text,
  is_minor boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade, -- null only for system_admin
  role public.app_role not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  check ((role = 'system_admin') = (org_id is null)),
  unique (user_id, org_id, role)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';
create index memberships_org_idx on public.memberships (org_id);

create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  unique (guardian_id, student_id)
);
create index guardian_links_org_idx on public.guardian_links (org_id);
create index guardian_links_student_idx on public.guardian_links (student_id);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('terms','guardian','selfie')),
  terms_version text not null,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now()
);
create index consents_user_idx on public.consents (user_id);
create index consents_org_idx on public.consents (org_id);

-- Device secrets are private: only server code touches them.
create table private.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,
  label text,
  status text not null default 'active' check (status in ('active','pending','revoked')),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index devices_one_active_per_user on private.devices (user_id) where status = 'active';

-- Helper functions. SECURITY DEFINER lives in private, fixed search_path, never granted to anon.
create function private.is_system_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
    where m.user_id = (select auth.uid()) and m.role = 'system_admin' and m.status = 'active');
$$;

create function private.has_org_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.memberships m
      where m.user_id = (select auth.uid()) and m.org_id = p_org
        and m.status = 'active' and m.role = any (p_roles))
    or exists (select 1 from public.memberships m
      where m.user_id = (select auth.uid()) and m.role = 'system_admin' and m.status = 'active'));
$$;

create function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from public.memberships m
      where m.user_id = (select auth.uid()) and m.org_id = p_org and m.status = 'active')
    or private.is_system_admin());
$$;

create function private.is_guardian_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardian_links g
    where g.guardian_id = (select auth.uid()) and g.student_id = p_student and g.confirmed_at is not null);
$$;

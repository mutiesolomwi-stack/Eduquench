-- Hash-chained, insert-only audit log (ARD section 11).
create table private.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,                     -- null for platform-level events
  actor_id uuid,                   -- replaced by an anonymous reference on erasure
  action text not null,
  entity text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  source text not null default 'server',
  created_at timestamptz not null default clock_timestamp(),
  prev_hash text not null,
  hash text not null
);
create index audit_log_org_idx on private.audit_log (org_id, created_at desc);

create trigger audit_log_no_change
  before update or delete on private.audit_log
  for each row execute function private.reject_change();
create trigger audit_log_no_truncate
  before truncate on private.audit_log
  for each statement execute function private.reject_change();
revoke update, delete, truncate on private.audit_log from public, anon, authenticated, service_role;

create function private.audit_row_hash(p_prev text, p_org uuid, p_actor uuid, p_action text, p_entity text,
  p_entity_id text, p_old jsonb, p_new jsonb, p_reason text, p_source text, p_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, coalesce(p_org::text,''), coalesce(p_actor::text,''),
    p_action, p_entity, coalesce(p_entity_id,''), coalesce(p_old::text,''), coalesce(p_new::text,''),
    coalesce(p_reason,''), p_source, extract(epoch from p_at)::text), 'UTF8')), 'hex');
$$;

create function private.write_audit(p_org uuid, p_actor uuid, p_action text, p_entity text,
  p_entity_id text, p_old jsonb, p_new jsonb, p_reason text default null, p_source text default 'server')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_prev text; v_at timestamptz := clock_timestamp(); v_hash text; v_id bigint;
begin
  perform pg_advisory_xact_lock(7770001);              -- serialise the chain
  select hash into v_prev from private.audit_log order by id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_hash := private.audit_row_hash(v_prev, p_org, p_actor, p_action, p_entity, p_entity_id, p_old, p_new, p_reason, p_source, v_at);
  insert into private.audit_log (org_id, actor_id, action, entity, entity_id, old_value, new_value, reason, source, created_at, prev_hash, hash)
  values (p_org, p_actor, p_action, p_entity, p_entity_id, p_old, p_new, p_reason, p_source, v_at, v_prev, v_hash)
  returning id into v_id;
  return v_id;
end $$;

-- Returns the id of the first broken row, or null when the chain is intact.
create function private.verify_audit_chain() returns bigint
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_prev text := repeat('0', 64);
begin
  for r in select * from private.audit_log order by id loop
    if r.prev_hash <> v_prev or r.hash <> private.audit_row_hash(r.prev_hash, r.org_id, r.actor_id, r.action,
        r.entity, r.entity_id, r.old_value, r.new_value, r.reason, r.source, r.created_at) then
      return r.id;
    end if;
    v_prev := r.hash;
  end loop;
  return null;
end $$;

-- Read-only window for school admins / system admin; insert is server only.
create view public.audit_log_view with (security_invoker = false) as
  select a.id, a.org_id, a.actor_id, a.action, a.entity, a.entity_id, a.old_value, a.new_value, a.reason, a.source, a.created_at
  from private.audit_log a
  where (a.org_id is not null and private.has_org_role(a.org_id, array['school_admin']::public.app_role[]))
     or private.is_system_admin();

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('access','correction','deletion')),
  status text not null default 'open' check (status in ('open','done','rejected')),
  created_at timestamptz not null default now()
);
create index data_requests_org_idx on public.data_requests (org_id);
create index data_requests_user_idx on public.data_requests (user_id);

-- Notifications: outbox drives all delivery.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, title text not null, body text,
  critical boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_org_idx on public.notifications (org_id);

create table public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push boolean not null default true,
  email boolean not null default true,
  sms boolean not null default false
);

create table private.outbox (
  id bigint generated always as identity primary key,
  notification_id uuid references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app','push','email','sms','whatsapp')),
  recipient text not null, payload jsonb not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','sent','failed','permanent_failure')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index outbox_waiting_idx on private.outbox (next_attempt_at) where status = 'waiting';
create index outbox_notification_idx on private.outbox (notification_id);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

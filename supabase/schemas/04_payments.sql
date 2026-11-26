create table public.fee_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  kind text not null check (kind in ('full_course','per_session','monthly','instalment')),
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'KES' check (currency = 'KES'),
  sessions_covered int check (sessions_covered is null or sessions_covered > 0),
  active boolean not null default true
);
create index fee_plans_org_idx on public.fee_plans (org_id);
create index fee_plans_class_idx on public.fee_plans (class_id);

-- Payment intent: created BEFORE the STK push; the callback must match it.
create table private.payment_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  payer_id uuid not null references auth.users(id),
  beneficiary_id uuid not null references auth.users(id),   -- declared when paying for someone else
  fee_plan_id uuid not null references public.fee_plans(id),
  phone text not null check (phone ~ '^254[0-9]{9}$'),
  amount numeric(12,2) not null check (amount > 0),
  checkout_request_id text unique,
  merchant_request_id text,
  status text not null default 'pending' check (status in ('pending','confirmed','failed','expired')),
  created_at timestamptz not null default now()
);
create index payment_intents_org_idx on private.payment_intents (org_id);
create index payment_intents_pending_idx on private.payment_intents (created_at) where status = 'pending';
create index payment_intents_fee_plan_idx on private.payment_intents (fee_plan_id);

-- Payments: server-only writes. Students/staff get SELECT through RLS (summary rows only).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  intent_id uuid references private.payment_intents(id),
  payer_id uuid not null references auth.users(id),
  beneficiary_id uuid not null references auth.users(id),
  fee_plan_id uuid references public.fee_plans(id),
  mpesa_receipt text not null unique,          -- one payment per receipt: stops replays
  amount numeric(12,2) not null check (amount > 0),
  currency char(3) not null default 'KES',
  state text not null default 'matched' check (state in ('matched','unmatched','refunded')),
  paid_at timestamptz not null default now()
);
create index payments_org_idx on public.payments (org_id);
create index payments_payer_idx on public.payments (payer_id);
create index payments_beneficiary_idx on public.payments (beneficiary_id);
create index payments_fee_plan_idx on public.payments (fee_plan_id);
create index payments_intent_idx on public.payments (intent_id);

create table public.exemptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) >= 3),
  kind text not null check (kind in ('scholarship','staff','trial','sponsored','late_payment')),
  granted_by uuid not null references auth.users(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index exemptions_org_idx on public.exemptions (org_id);
create index exemptions_class_idx on public.exemptions (class_id);
create index exemptions_student_idx on public.exemptions (student_id);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid unique references public.payments(id),   -- one entitlement per payment
  exemption_id uuid unique references public.exemptions(id),
  status public.entitlement_status not null default 'active',
  sessions_remaining int,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  check ((payment_id is not null) <> (exemption_id is not null))
);
create index entitlements_org_idx on public.entitlements (org_id);
create index entitlements_class_student_idx on public.entitlements (class_id, student_id);
create index entitlements_student_idx on public.entitlements (student_id);

-- Credentials store hashes only; random 128-bit link token, NOT derived from the M-Pesa receipt.
create table private.access_credentials (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null unique references public.entitlements(id) on delete cascade,
  payment_id uuid references public.payments(id),
  link_token_hash bytea not null unique,
  code_hash bytea not null,
  created_at timestamptz not null default now()
);
create index access_credentials_payment_idx on private.access_credentials (payment_id);

create table private.refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  requested_by uuid not null references auth.users(id),
  teacher_approved_by uuid references auth.users(id),
  final_approved_by uuid references auth.users(id),
  status text not null default 'requested' check (status in ('requested','teacher_approved','approved','rejected','paid')),
  created_at timestamptz not null default now()
);
create index refunds_org_idx on private.refunds (org_id);
create index refunds_payment_idx on private.refunds (payment_id);

create table private.commission_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = platform default
  percent numeric(5,2) not null check (percent between 0 and 100),
  effective_from date not null default current_date
);
create index commission_rules_org_idx on private.commission_rules (org_id);

-- Ledger is append-only; corrections are reversing entries.
create table private.ledger_entries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id),
  payment_id uuid not null references public.payments(id),
  kind text not null check (kind in ('collection','commission','school_share','reversal')),
  amount numeric(12,2) not null,
  currency char(3) not null default 'KES',
  created_at timestamptz not null default now()
);
create index ledger_org_idx on private.ledger_entries (org_id);
create index ledger_payment_idx on private.ledger_entries (payment_id);

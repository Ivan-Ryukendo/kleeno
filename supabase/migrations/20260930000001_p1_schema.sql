-- P1 thin slice schema. Every table: company_id NOT NULL, RLS on, authenticated = SELECT own company only,
-- anon = nothing, writes only through server repositories (service role). Rules 32, 34, 48, 49.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_demo boolean not null default false,
  live_payments_enabled boolean not null default false,
  per_payment_ceiling bigint not null default 100000000 check (per_payment_ceiling >= 0),
  guard_address text check (guard_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at timestamptz not null default now()
);

-- company_id of a company row is its own id, so the generic RLS shape works too.
alter table public.companies add column company_id uuid generated always as (id) stored;
alter table public.companies add constraint companies_company_id_id unique (company_id, id);

create table public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  role text not null check (role in ('PAYROLL_APPROVER', 'PAYMENT_APPROVER', 'HR_APPROVER', 'VIEWER')),
  unique (company_id, id)
);

create table public.company_wallets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  role text not null check (role in ('APPROVER', 'AGENT')),
  circle_wallet_id text not null,
  address text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  blockchain text not null check (blockchain = 'ARC-TESTNET'),
  unique (company_id, role),
  unique (company_id, id)
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  pseudonym text not null,
  pay_type text not null check (pay_type in ('SALARIED', 'HOURLY', 'RETAINER')),
  base_amount bigint not null check (base_amount >= 0),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  wallet_id text,
  unique (company_id, id),
  unique (company_id, pseudonym)
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  mode text not null check (mode in ('SIMULATION', 'LIVE_TESTNET')),
  status text not null check (status in ('CALCULATION_VALIDATED', 'APPROVED', 'PAYING', 'PAID', 'RECONCILED')),
  config_version int not null check (config_version > 0),
  payroll_approver_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, payroll_approver_id) references public.app_users (company_id, id)
);

create table public.calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  config_version int not null check (config_version > 0),
  calculation_hash text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id)
);

create table public.calculation_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  calculation_id uuid not null,
  worker_id uuid not null,
  gross bigint not null check (gross >= 0),
  deductions bigint not null check (deductions >= 0),
  net bigint not null check (net >= 0),
  trace jsonb not null,
  check (net = gross - deductions),
  unique (company_id, id),
  unique (calculation_id, worker_id),
  foreign key (company_id, calculation_id) references public.calculations (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id)
);

create table public.payroll_approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  calculation_id uuid not null,
  calculation_hash text not null,
  approver_id uuid not null,
  approved_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, calculation_id) references public.calculations (company_id, id),
  foreign key (company_id, approver_id) references public.app_users (company_id, id)
);

create table public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  status text not null check (status in ('PROPOSED', 'AUTHORIZED', 'OPEN', 'COMPLETED', 'CLOSED', 'DISCARDED')),
  authorizer_id uuid,
  plan_hash text not null,
  plan jsonb not null,
  guard_run_key text unique,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, authorizer_id) references public.app_users (company_id, id)
);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  worker_id uuid not null,
  calculation_line_id uuid not null,
  approval_id uuid not null,
  batch_id uuid,
  amount bigint not null check (amount > 0),
  currency text not null check (currency = 'USDC'),
  network text not null check (network = 'ARC-TESTNET'),
  recipient text not null check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  config_version int not null check (config_version > 0),
  calculation_hash text not null,
  idempotency_key uuid not null unique,
  onchain_key text not null unique check (onchain_key ~ '^0x[0-9a-f]{64}$'),
  status text not null default 'CREATED'
    check (status in ('CREATED', 'AUTHORIZED', 'ON_HOLD', 'PAYING', 'SETTLED', 'PAYMENT_EXCEPTION')),
  exception_code text,
  exception_reasons text[],
  tx_hash text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, calculation_line_id), -- one obligation per calculation line
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id),
  foreign key (company_id, calculation_line_id) references public.calculation_lines (company_id, id),
  foreign key (company_id, approval_id) references public.payroll_approvals (company_id, id),
  foreign key (company_id, batch_id) references public.payment_batches (company_id, id)
);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  obligation_id uuid not null,
  idempotency_key uuid not null unique,
  state text not null check (state in ('SUBMISSION_PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN')),
  circle_tx_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, obligation_id) references public.obligations (company_id, id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  event text not null,
  entity_type text not null,
  entity_id uuid,
  actor text not null, -- user id or 'system'
  refs jsonb not null default '{}'::jsonb, -- references only, never payroll values (S45)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Triggers: audit is append-only; approved records are immutable; obligations change only status etc.
-- ---------------------------------------------------------------------------------------------
create function public.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is immutable', tg_table_name using errcode = 'P0001';
end $$;

create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function public.forbid_change();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.forbid_change();
create trigger calculations_immutable before update or delete on public.calculations
  for each row execute function public.forbid_change();
create trigger calculation_lines_immutable before update or delete on public.calculation_lines
  for each row execute function public.forbid_change();
create trigger payroll_approvals_immutable before update or delete on public.payroll_approvals
  for each row execute function public.forbid_change();

create function public.obligations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'obligations cannot be deleted' using errcode = 'P0001';
  end if;
  if (new.id, new.company_id, new.run_id, new.worker_id, new.calculation_line_id, new.approval_id,
      new.amount, new.currency, new.network, new.recipient, new.config_version, new.calculation_hash,
      new.idempotency_key, new.onchain_key)
     is distinct from
     (old.id, old.company_id, old.run_id, old.worker_id, old.calculation_line_id, old.approval_id,
      old.amount, old.currency, old.network, old.recipient, old.config_version, old.calculation_hash,
      old.idempotency_key, old.onchain_key) then
    raise exception 'obligation fields are immutable' using errcode = 'P0001';
  end if;
  new.updated_at = now();
  return new;
end $$;

create trigger obligations_guard before update or delete on public.obligations
  for each row execute function public.obligations_guard();

-- ---------------------------------------------------------------------------------------------
-- RLS: authenticated reads its own company only; anon nothing; no write grants to API roles.
-- ---------------------------------------------------------------------------------------------
create function public.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from public.app_users where id = (select auth.uid())
$$;
revoke all on function public.current_company_id() from public, anon;
grant execute on function public.current_company_id() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['companies', 'app_users', 'company_wallets', 'workers', 'payroll_runs', 'calculations',
    'calculation_lines', 'payroll_approvals', 'payment_batches', 'obligations', 'payment_attempts', 'audit_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    -- (select ...) makes Postgres evaluate the function once per query, not once per row
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.current_company_id()))',
      t || '_select_own_company', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Indexes: Postgres does not index foreign keys. Every index leads with company_id because every
-- RLS filter and repository read is scoped by company. (Tiny FK columns such as approver ids are skipped.)
-- ---------------------------------------------------------------------------------------------
create index payroll_runs_company_created_idx on public.payroll_runs (company_id, created_at desc);
create index calculation_lines_worker_idx on public.calculation_lines (company_id, worker_id);
create index payment_batches_run_idx on public.payment_batches (company_id, run_id);
create index obligations_run_idx on public.obligations (company_id, run_id);
create index obligations_worker_idx on public.obligations (company_id, worker_id);
create index obligations_batch_idx on public.obligations (company_id, batch_id) where batch_id is not null;
create index obligations_in_flight_idx on public.obligations (company_id, status) where status in ('AUTHORIZED', 'PAYING'); -- crash recovery scan (P4)
create index payment_attempts_obligation_idx on public.payment_attempts (company_id, obligation_id);
create index audit_events_company_created_idx on public.audit_events (company_id, created_at desc);

-- Trigger functions are never meant to be called directly.
revoke all on function public.forbid_change() from public, anon, authenticated;
revoke all on function public.obligations_guard() from public, anon, authenticated;

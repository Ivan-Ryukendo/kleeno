-- P2 foundation. Adds: state-machine + kill-switch + four-eyes + immutability triggers, config/compensation/exception
-- tables, per-company key table, MFA-aware RLS, encrypted money columns (S41). Rules 13-18, 32, 34, 48, 49.

-- ---------------------------------------------------------------------------------------------
-- 0. Clear the P1 synthetic run (its amounts were plain columns, which S41 forbids). Audit rows are kept.
-- ---------------------------------------------------------------------------------------------
alter table public.obligations disable trigger user;
alter table public.payroll_approvals disable trigger user;
alter table public.calculation_lines disable trigger user;
alter table public.calculations disable trigger user;
delete from public.payment_attempts;
delete from public.obligations;
delete from public.payment_batches;
delete from public.payroll_approvals;
delete from public.calculation_lines;
delete from public.calculations;
delete from public.payroll_runs;
delete from public.workers;
alter table public.obligations enable trigger user;
alter table public.payroll_approvals enable trigger user;
alter table public.calculation_lines enable trigger user;
alter table public.calculations enable trigger user;

-- ---------------------------------------------------------------------------------------------
-- 1. Accounts, keys
-- ---------------------------------------------------------------------------------------------
alter table public.companies add column mfa_required boolean not null default false;
alter table public.app_users add column email text;
create unique index app_users_email_key on public.app_users (lower(email));

create table public.company_keys (
  company_id uuid primary key references public.companies (id),
  wrapped_key text not null, -- per-company data key, AES-256-GCM wrapped by DATA_ENCRYPTION_KEY (S41)
  key_version int not null check (key_version > 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- 2. Workers, compensation (encrypted, versioned), configuration versions
-- ---------------------------------------------------------------------------------------------
alter table public.workers drop column base_amount;
alter table public.workers alter column wallet_address drop not null;
alter table public.workers add column wallet_source text not null default 'CIRCLE' check (wallet_source in ('CIRCLE', 'EXTERNAL'));
alter table public.workers add column active boolean not null default true;
create unique index workers_wallet_id_key on public.workers (wallet_id) where wallet_id is not null; -- one wallet per worker (S26)

create table public.compensations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  worker_id uuid not null,
  version int not null check (version > 0),
  payload_enc text not null, -- { baseAmount, hourlyRate } encrypted (S41)
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (worker_id, version),
  foreign key (company_id, worker_id) references public.workers (company_id, id),
  foreign key (company_id, created_by) references public.app_users (company_id, id)
);

create function public.config_params_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and (p ->> 'overtimeMultiplier')::numeric between 1 and 3
    and (p ->> 'aboveCapMultiplier')::numeric between 1 and 3
    and coalesce((select bool_and((d ->> 'percent')::numeric between 0 and 100) from jsonb_array_elements(p -> 'deductions') d), true)
$$;

create table public.payroll_configurations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  version int not null check (version > 0),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'AI_PROPOSED', 'VALIDATED', 'HUMAN_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  params jsonb not null check (public.config_params_ok(params)), -- numbers and rule IDs: plain (S41)
  clauses_enc text not null, -- policy clause text, encrypted (S41)
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, version),
  foreign key (company_id, created_by) references public.app_users (company_id, id),
  foreign key (company_id, approved_by) references public.app_users (company_id, id),
  check (status not in ('APPROVED', 'ACTIVE', 'SUPERSEDED') or (approved_by is not null and approved_at is not null))
);
create unique index payroll_configurations_one_active on public.payroll_configurations (company_id) where status = 'ACTIVE'; -- S35

-- ---------------------------------------------------------------------------------------------
-- 3. Runs, calculations (encrypted snapshot + lines), exceptions, audit columns
-- ---------------------------------------------------------------------------------------------
alter table public.payroll_runs drop constraint payroll_runs_status_check;
alter table public.payroll_runs add constraint payroll_runs_status_check check (status in (
  'DRAFT', 'DATA_IMPORTED', 'RECONCILING', 'EXCEPTIONS_PENDING', 'READY_FOR_CALCULATION', 'CALCULATED',
  'CALCULATION_VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OBLIGATIONS_CREATED',
  'PAYMENT_IN_PROGRESS', 'PARTIALLY_SETTLED', 'PAYMENT_FAILED', 'SETTLED', 'RECONCILED'));
alter table public.payroll_runs alter column status set default 'DRAFT';
alter table public.payroll_runs add column period_start date not null;
alter table public.payroll_runs add column period_end date not null;
alter table public.payroll_runs add column created_by uuid;
alter table public.payroll_runs add constraint payroll_runs_period_order check (period_end >= period_start);
-- S38 backstop: a SIMULATION run can never leave the early states.
alter table public.payroll_runs add constraint payroll_runs_simulation_stops check (
  mode <> 'SIMULATION' or status in ('DRAFT', 'DATA_IMPORTED', 'RECONCILING', 'EXCEPTIONS_PENDING', 'READY_FOR_CALCULATION', 'CALCULATED', 'CALCULATION_VALIDATED'));
alter table public.payroll_runs add foreign key (company_id, config_version) references public.payroll_configurations (company_id, version);
alter table public.payroll_runs add foreign key (company_id, created_by) references public.app_users (company_id, id);

alter table public.calculations add column snapshot_enc text not null; -- config + compensation + inputs, encrypted (S41)
alter table public.calculation_lines add column gross_enc text not null;
alter table public.calculation_lines add column deductions_enc text not null;
alter table public.calculation_lines add column trace_enc text not null;
alter table public.calculation_lines drop column gross;
alter table public.calculation_lines drop column deductions;
alter table public.calculation_lines drop column trace; -- net stays plain: it is public on-chain anyway

create table public.exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  worker_id uuid,
  category text not null check (category in (
    'UNEXPLAINED_MISSING_HOURS', 'DUPLICATE_TIMESHEET', 'UNAPPROVED_OVERTIME', 'LEAVE_WORK_CONFLICT',
    'AI_OUTPUT_INVALID', 'PAYMENT_EXCEPTION', 'SETTLEMENT_MISMATCH')),
  severity text not null check (severity in ('LOW', 'MEDIUM', 'HIGH')),
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED')),
  evidence jsonb not null default '{}'::jsonb, -- record IDs and hours only
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id),
  foreign key (company_id, resolved_by) references public.app_users (company_id, id),
  check (status not in ('RESOLVED', 'REJECTED') or (resolved_by is not null and resolved_at is not null))
);

alter table public.audit_events add column correlation_id text;
alter table public.audit_events add column actor_type text not null default 'system'
  check (actor_type in ('user', 'ai', 'system', 'agent', 'script'));

-- ---------------------------------------------------------------------------------------------
-- 4. State machines (S18). The pairs mirror src/core/domain/machines.ts; tests/db/cas.test.ts compares them.
-- ---------------------------------------------------------------------------------------------
create function public.transition_allowed(p_machine text, p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1 from (values
('payroll_runs', 'DRAFT', 'DATA_IMPORTED'),
    ('payroll_runs', 'DATA_IMPORTED', 'RECONCILING'),
    ('payroll_runs', 'RECONCILING', 'EXCEPTIONS_PENDING'),
    ('payroll_runs', 'RECONCILING', 'READY_FOR_CALCULATION'),
    ('payroll_runs', 'EXCEPTIONS_PENDING', 'READY_FOR_CALCULATION'),
    ('payroll_runs', 'READY_FOR_CALCULATION', 'CALCULATED'),
    ('payroll_runs', 'CALCULATED', 'CALCULATION_VALIDATED'),
    ('payroll_runs', 'CALCULATION_VALIDATED', 'PENDING_APPROVAL'),
    ('payroll_runs', 'PENDING_APPROVAL', 'APPROVED'),
    ('payroll_runs', 'PENDING_APPROVAL', 'REJECTED'),
    ('payroll_runs', 'APPROVED', 'OBLIGATIONS_CREATED'),
    ('payroll_runs', 'OBLIGATIONS_CREATED', 'PAYMENT_IN_PROGRESS'),
    ('payroll_runs', 'PAYMENT_IN_PROGRESS', 'SETTLED'),
    ('payroll_runs', 'PAYMENT_IN_PROGRESS', 'PARTIALLY_SETTLED'),
    ('payroll_runs', 'PAYMENT_IN_PROGRESS', 'PAYMENT_FAILED'),
    ('payroll_runs', 'PARTIALLY_SETTLED', 'PAYMENT_IN_PROGRESS'),
    ('payroll_runs', 'PAYMENT_FAILED', 'PAYMENT_IN_PROGRESS'),
    ('payroll_runs', 'PAYMENT_FAILED', 'PAYMENT_IN_PROGRESS'),
    ('payroll_runs', 'SETTLED', 'RECONCILED'),
    ('payroll_configurations', 'DRAFT', 'AI_PROPOSED'),
    ('payroll_configurations', 'DRAFT', 'VALIDATED'),
    ('payroll_configurations', 'DRAFT', 'ARCHIVED'),
    ('payroll_configurations', 'AI_PROPOSED', 'VALIDATED'),
    ('payroll_configurations', 'AI_PROPOSED', 'ARCHIVED'),
    ('payroll_configurations', 'VALIDATED', 'HUMAN_REVIEW'),
    ('payroll_configurations', 'VALIDATED', 'ARCHIVED'),
    ('payroll_configurations', 'HUMAN_REVIEW', 'APPROVED'),
    ('payroll_configurations', 'HUMAN_REVIEW', 'DRAFT'),
    ('payroll_configurations', 'APPROVED', 'ACTIVE'),
    ('payroll_configurations', 'ACTIVE', 'SUPERSEDED'),
    ('payroll_configurations', 'ACTIVE', 'ARCHIVED'),
    ('payroll_configurations', 'SUPERSEDED', 'ARCHIVED'),
    ('exceptions', 'OPEN', 'IN_REVIEW'),
    ('exceptions', 'IN_REVIEW', 'RESOLVED'),
    ('exceptions', 'IN_REVIEW', 'REJECTED'),
    ('exceptions', 'IN_REVIEW', 'ESCALATED'),
    ('exceptions', 'ESCALATED', 'RESOLVED'),
    ('exceptions', 'ESCALATED', 'REJECTED'),
    ('exceptions', 'ESCALATED', 'IN_REVIEW'),
    ('obligations', 'CREATED', 'AUTHORIZED'),
    ('obligations', 'CREATED', 'ON_HOLD'),
    ('obligations', 'ON_HOLD', 'AUTHORIZED'),
    ('obligations', 'AUTHORIZED', 'PAYING'),
    ('obligations', 'AUTHORIZED', 'PAYMENT_EXCEPTION'),
    ('obligations', 'PAYING', 'SETTLED'),
    ('obligations', 'PAYING', 'PAYMENT_EXCEPTION'),
    ('payment_batches', 'PROPOSED', 'AUTHORIZED'),
    ('payment_batches', 'PROPOSED', 'DISCARDED'),
    ('payment_batches', 'AUTHORIZED', 'OPEN'),
    ('payment_batches', 'OPEN', 'COMPLETED'),
    ('payment_batches', 'OPEN', 'CLOSED')
    ) as v (machine, from_state, to_state)
    where v.machine = p_machine and v.from_state = p_from and v.to_state = p_to)
$$;

create function public.enforce_status_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and not public.transition_allowed(tg_table_name, old.status, new.status) then
    raise exception '% status % -> % is not allowed', tg_table_name, old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Rows are born in their machine's first state; everything after goes through transitions.
create function public.enforce_initial_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from tg_argv[0] then
    raise exception '% must start as %', tg_table_name, tg_argv[0] using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payroll_runs_transition before update on public.payroll_runs for each row execute function public.enforce_status_transition();
create trigger payroll_configurations_transition before update on public.payroll_configurations for each row execute function public.enforce_status_transition();
create trigger exceptions_transition before update on public.exceptions for each row execute function public.enforce_status_transition();
create trigger obligations_transition before update on public.obligations for each row execute function public.enforce_status_transition();
create trigger payment_batches_transition before update on public.payment_batches for each row execute function public.enforce_status_transition();

create trigger payroll_runs_initial before insert on public.payroll_runs for each row execute function public.enforce_initial_status('DRAFT');
create trigger payroll_configurations_initial before insert on public.payroll_configurations for each row execute function public.enforce_initial_status('DRAFT');
create trigger exceptions_initial before insert on public.exceptions for each row execute function public.enforce_initial_status('OPEN');
create trigger obligations_initial before insert on public.obligations for each row execute function public.enforce_initial_status('CREATED');
create trigger payment_batches_initial before insert on public.payment_batches for each row execute function public.enforce_initial_status('PROPOSED');

-- Atomic compare-and-set + audit event in one commit. False = someone else moved it first.
create function public.cas_transition(
  p_table text, p_company uuid, p_id uuid, p_from text, p_to text,
  p_entity_type text, p_event text, p_actor text, p_actor_type text, p_correlation text, p_refs jsonb
) returns boolean
language plpgsql set search_path = '' as $$
declare n int;
begin
  if p_table not in ('payroll_runs', 'payroll_configurations', 'exceptions', 'obligations', 'payment_batches') then
    raise exception 'table not allowed' using errcode = 'P0001';
  end if;
  execute format('update public.%I set status = $1 where id = $2 and company_id = $3 and status = $4', p_table)
    using p_to, p_id, p_company, p_from;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  insert into public.audit_events (company_id, event, entity_type, entity_id, actor, actor_type, correlation_id, refs)
    values (p_company, p_event, p_entity_type, p_id, p_actor, p_actor_type, p_correlation, coalesce(p_refs, '{}'::jsonb));
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Kill switch backstop (S06, rule 17): with live payments disabled nothing that starts a payment can be written.
-- ---------------------------------------------------------------------------------------------
create function public.require_live_payments() returns trigger
language plpgsql set search_path = '' as $$
declare enabled boolean;
begin
  select live_payments_enabled into enabled from public.companies where id = new.company_id;
  if not coalesce(enabled, false) then
    raise exception 'live payments are disabled for this company' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger payroll_runs_live_only before insert on public.payroll_runs
  for each row when (new.mode = 'LIVE_TESTNET') execute function public.require_live_payments();
create trigger payment_batches_kill_switch before insert or update of status on public.payment_batches
  for each row when (new.status = 'AUTHORIZED') execute function public.require_live_payments();
create trigger payment_attempts_kill_switch before insert on public.payment_attempts
  for each row execute function public.require_live_payments();
create trigger obligations_claim_kill_switch before update of status on public.obligations
  for each row when (new.status = 'PAYING' and old.status is distinct from 'PAYING') execute function public.require_live_payments();

-- ---------------------------------------------------------------------------------------------
-- 6. Four-eyes and approval integrity (rules 15, 16, 18)
-- ---------------------------------------------------------------------------------------------
create function public.payroll_approvals_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r record; c record; approver_role text;
begin
  select mode, status into r from public.payroll_runs where id = new.run_id and company_id = new.company_id;
  select calculation_hash, run_id into c from public.calculations where id = new.calculation_id and company_id = new.company_id;
  select u.role into approver_role from public.app_users u where u.id = new.approver_id and u.company_id = new.company_id;
  if r.mode is distinct from 'LIVE_TESTNET' then raise exception 'only a LIVE_TESTNET run can be approved for payment' using errcode = 'P0001'; end if;
  if r.status is distinct from 'PENDING_APPROVAL' then raise exception 'run is not pending approval' using errcode = 'P0001'; end if;
  if c.run_id is distinct from new.run_id or c.calculation_hash is distinct from new.calculation_hash then
    raise exception 'approval must bind the run calculation hash' using errcode = 'P0001';
  end if;
  if approver_role is null or approver_role not in ('PAYROLL_APPROVER', 'HR_APPROVER') then raise exception 'approver lacks the payroll role' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger payroll_approvals_guard before insert on public.payroll_approvals for each row execute function public.payroll_approvals_guard();

create function public.obligations_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r record; a record;
begin
  select mode, status into r from public.payroll_runs where id = new.run_id and company_id = new.company_id;
  select run_id, calculation_hash into a from public.payroll_approvals where id = new.approval_id and company_id = new.company_id;
  if r.mode is distinct from 'LIVE_TESTNET' or r.status not in ('APPROVED', 'OBLIGATIONS_CREATED') then
    raise exception 'obligations exist only for an approved LIVE_TESTNET run' using errcode = 'P0001';
  end if;
  if a.run_id is distinct from new.run_id or a.calculation_hash is distinct from new.calculation_hash then
    raise exception 'obligation must match its run approval' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger obligations_insert_guard before insert on public.obligations for each row execute function public.obligations_insert_guard();

create function public.payment_batches_guard() returns trigger
language plpgsql set search_path = '' as $$
declare approver uuid; authorizer_role text;
begin
  if tg_op = 'DELETE' then raise exception 'payment batches cannot be deleted' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.id, new.company_id, new.run_id, new.plan, new.plan_hash)
     is distinct from (old.id, old.company_id, old.run_id, old.plan, old.plan_hash) then
    raise exception 'the signed plan is immutable' using errcode = 'P0001';
  end if;
  if new.status in ('AUTHORIZED', 'OPEN', 'COMPLETED', 'CLOSED') then
    select approver_id into approver from public.payroll_approvals where run_id = new.run_id and company_id = new.company_id;
    select u.role into authorizer_role from public.app_users u where u.id = new.authorizer_id and u.company_id = new.company_id;
    if approver is null then raise exception 'no payroll approval for this run' using errcode = 'P0001'; end if;
    if approver = new.authorizer_id then raise exception 'authorizer must differ from the payroll approver' using errcode = 'P0001'; end if;
    if authorizer_role is distinct from 'PAYMENT_APPROVER' then raise exception 'authorizer lacks the payment role' using errcode = 'P0001'; end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger payment_batches_guard before insert or update or delete on public.payment_batches for each row execute function public.payment_batches_guard();

-- ---------------------------------------------------------------------------------------------
-- 7. Immutability (S19): approved configs, compensation versions, runs' identity, truncate on every protected table
-- ---------------------------------------------------------------------------------------------
create function public.payroll_configurations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('APPROVED', 'ACTIVE', 'SUPERSEDED') then raise exception 'an approved config cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status in ('APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')
     and (new.id, new.company_id, new.version, new.params, new.clauses_enc, new.approved_by, new.approved_at)
     is distinct from (old.id, old.company_id, old.version, old.params, old.clauses_enc, old.approved_by, old.approved_at) then
    raise exception 'an approved config version is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payroll_configurations_guard before update or delete on public.payroll_configurations for each row execute function public.payroll_configurations_guard();

create function public.payroll_runs_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'payroll runs cannot be deleted' using errcode = 'P0001'; end if;
  if (new.id, new.company_id, new.mode, new.config_version, new.period_start, new.period_end, new.created_by)
     is distinct from (old.id, old.company_id, old.mode, old.config_version, old.period_start, old.period_end, old.created_by) then
    raise exception 'run mode, config version and period are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payroll_runs_guard before update or delete on public.payroll_runs for each row execute function public.payroll_runs_guard();

create trigger compensations_immutable before update or delete on public.compensations for each row execute function public.forbid_change();

do $$
declare t text;
begin
  foreach t in array array['calculations', 'calculation_lines', 'payroll_approvals', 'compensations', 'obligations',
    'payment_batches', 'payroll_runs', 'payroll_configurations', 'payment_attempts', 'company_wallets']
  loop
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. RLS: MFA-aware company lookup, policies and grants for the new tables (S10, S11, S43)
-- ---------------------------------------------------------------------------------------------
create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.company_id
  from public.app_users u join public.companies c on c.id = u.company_id
  where u.id = (select auth.uid())
    and (not c.mfa_required or (select auth.jwt() ->> 'aal') = 'aal2')
$$;

alter table public.company_keys enable row level security;
revoke all on public.company_keys from anon, authenticated;
grant all on public.company_keys to service_role; -- wrapped keys are never readable through the public API

do $$
declare t text;
begin
  foreach t in array array['compensations', 'payroll_configurations', 'exceptions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.current_company_id()))', t || '_select_own_company', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 9. Indexes (lead with company_id) and function privileges
-- ---------------------------------------------------------------------------------------------
create index compensations_worker_idx on public.compensations (company_id, worker_id, version desc);
create index payroll_configurations_company_idx on public.payroll_configurations (company_id, version desc);
create index exceptions_run_idx on public.exceptions (company_id, run_id);
create index exceptions_open_idx on public.exceptions (company_id, run_id) where status in ('OPEN', 'IN_REVIEW', 'ESCALATED');
create index payroll_runs_config_idx on public.payroll_runs (company_id, config_version);
create index audit_events_entity_idx on public.audit_events (company_id, entity_type, entity_id);

revoke all on function public.transition_allowed(text, text, text) from public, anon, authenticated;
revoke all on function public.enforce_status_transition() from public, anon, authenticated;
revoke all on function public.enforce_initial_status() from public, anon, authenticated;
revoke all on function public.require_live_payments() from public, anon, authenticated;
revoke all on function public.payroll_approvals_guard() from public, anon, authenticated;
revoke all on function public.obligations_insert_guard() from public, anon, authenticated;
revoke all on function public.payment_batches_guard() from public, anon, authenticated;
revoke all on function public.payroll_configurations_guard() from public, anon, authenticated;
revoke all on function public.payroll_runs_guard() from public, anon, authenticated;
revoke all on function public.cas_transition(text, uuid, uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cas_transition(text, uuid, uuid, text, text, text, text, text, text, text, jsonb) to service_role;

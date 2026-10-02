-- P3 slice 2: CSV import evidence. Every import-derived row carries provenance (S46, rule 53); re-imports are idempotent by
-- constraint (S26, rule 49); evidence is immutable, so a changed record is a new row, never an edit (S48).

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  import_type text not null check (import_type in ('TIMESHEETS', 'LEAVE', 'ACTUAL_PAID')),
  source_provider text not null check (source_provider in ('csv_upload')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'), -- keyed hash of the accepted normalized rows
  mapping jsonb not null, -- field -> column index; never header text
  row_count int not null check (row_count >= 0),
  rejected_count int not null check (rejected_count between 0 and row_count),
  rejected jsonb not null default '[]'::jsonb, -- [{row, field, code}]: line numbers and fixed codes, never cell text
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id, import_type, content_hash), -- the same file twice into one run is one batch
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, created_by) references public.app_users (company_id, id)
);

-- Provenance columns (identical on every evidence table): source_provider, object_type, object_id, fetched_at, source_hash and the
-- import batch (the "reference"). `occurrence` numbers identical rows inside one file, so a duplicated line is kept (and later flagged)
-- while the same file imported again changes nothing.
create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  import_batch_id uuid not null,
  worker_id uuid not null,
  work_date date not null,
  hours numeric(4, 2) not null check (hours between 0 and 24),
  approved_extra_hours numeric(4, 2) not null default 0 check (approved_extra_hours between 0 and hours),
  source_provider text not null check (source_provider = 'csv_upload'),
  object_type text not null check (object_type = 'timesheet'),
  object_id text not null check (object_id <> ''),
  fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  occurrence int not null default 1 check (occurrence >= 1),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id, source_hash, occurrence),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, import_batch_id) references public.import_batches (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id)
);

create table public.leave_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  import_batch_id uuid not null,
  worker_id uuid not null,
  leave_date date not null,
  leave_type text not null check (leave_type in ('PAID', 'UNPAID')),
  hours numeric(4, 2) not null check (hours between 0 and 24),
  source_provider text not null check (source_provider = 'csv_upload'),
  object_type text not null check (object_type = 'leave'),
  object_id text not null check (object_id <> ''),
  fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  occurrence int not null default 1 check (occurrence >= 1),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id, source_hash, occurrence),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, import_batch_id) references public.import_batches (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id)
);

create table public.actual_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  import_batch_id uuid not null,
  worker_id uuid not null,
  amount_enc text not null, -- what the business actually paid: pay level, so encrypted (S41)
  currency text not null check (currency = 'USD'),
  source_provider text not null check (source_provider = 'csv_upload'),
  object_type text not null check (object_type = 'actual_payment'),
  object_id text not null check (object_id <> ''),
  fetched_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  occurrence int not null default 1 check (occurrence >= 1),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, run_id, source_hash, occurrence),
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, import_batch_id) references public.import_batches (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id)
);

create index timesheets_run_idx on public.timesheets (company_id, run_id, worker_id, work_date);
create index leave_records_run_idx on public.leave_records (company_id, run_id, worker_id, leave_date);
create index actual_payments_run_idx on public.actual_payments (company_id, run_id, worker_id);
create index import_batches_run_idx on public.import_batches (company_id, run_id, created_at desc);

-- Evidence and batches are immutable and never deleted (S19, S48). A mistake means a new run.
do $$
declare t text;
begin
  foreach t in array array['import_batches', 'timesheets', 'leave_records', 'actual_payments']
  loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.forbid_change()', t || '_immutable', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.forbid_change()', t || '_no_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = (select public.current_company_id()))', t || '_select_own_company', t);
  end loop;
end $$;

-- One transaction: the batch and its rows, or nothing. Rows already present (same run, hash, occurrence) are skipped; returns how many were new.
create function public.save_import(p_batch jsonb, p_table text, p_rows jsonb) returns int
language plpgsql set search_path = '' as $$
declare n int;
begin
  insert into public.import_batches (id, company_id, run_id, import_type, source_provider, content_hash, mapping, row_count, rejected_count, rejected, created_by)
  select id, company_id, run_id, import_type, source_provider, content_hash, mapping, row_count, rejected_count, rejected, created_by
  from jsonb_populate_record(null::public.import_batches, p_batch);

  if p_table = 'timesheets' then
    with ins as (
      insert into public.timesheets (id, company_id, run_id, import_batch_id, worker_id, work_date, hours, approved_extra_hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence)
      select id, company_id, run_id, import_batch_id, worker_id, work_date, hours, approved_extra_hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence
      from jsonb_populate_recordset(null::public.timesheets, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  elsif p_table = 'leave_records' then
    with ins as (
      insert into public.leave_records (id, company_id, run_id, import_batch_id, worker_id, leave_date, leave_type, hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence)
      select id, company_id, run_id, import_batch_id, worker_id, leave_date, leave_type, hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence
      from jsonb_populate_recordset(null::public.leave_records, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  elsif p_table = 'actual_payments' then
    with ins as (
      insert into public.actual_payments (id, company_id, run_id, import_batch_id, worker_id, amount_enc, currency, source_provider, object_type, object_id, fetched_at, source_hash, occurrence)
      select id, company_id, run_id, import_batch_id, worker_id, amount_enc, currency, source_provider, object_type, object_id, fetched_at, source_hash, occurrence
      from jsonb_populate_recordset(null::public.actual_payments, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  else
    raise exception 'unknown evidence table' using errcode = 'P0001';
  end if;
  return n;
end $$;

revoke all on function public.save_import(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_import(jsonb, text, jsonb) to service_role;

-- P3 slice 3: reconciliation exceptions. Stable identity (no duplicates on re-run), the decisions a person may take, the
-- decision actually taken, immutable once resolved, and a database backstop for rule 14 (open exceptions block calculation).

alter table public.exceptions add column dedupe_key text;
alter table public.exceptions add column options jsonb not null default '[]'::jsonb; -- decisions offered (ids from core/reconciliation OPTIONS)
alter table public.exceptions add column resolution_action text check (resolution_action in (
  'KEEP_ALL', 'KEEP_FIRST', 'KEEP_LATEST', 'KEEP_WORK', 'KEEP_LEAVE', 'KEEP_BOTH', 'APPROVE_HOURS', 'EXCLUDE_HOURS', 'TREAT_AS_PAID_LEAVE', 'TREAT_AS_UNPAID_LEAVE'));
alter table public.exceptions add column ai_execution_id uuid;
alter table public.exceptions add column ai_suggestion jsonb; -- {action, confidence}: a suggestion, never a resolution
alter table public.exceptions add foreign key (company_id, ai_execution_id) references public.ai_executions (company_id, id);
alter table public.exceptions add constraint exceptions_dedupe unique (company_id, run_id, dedupe_key); -- NULLs (system exceptions) stay distinct
alter table public.exceptions add constraint exceptions_recon_resolved_has_action check (
  status <> 'RESOLVED' or category not in ('DUPLICATE_TIMESHEET', 'LEAVE_WORK_CONFLICT', 'UNAPPROVED_OVERTIME', 'UNEXPLAINED_MISSING_HOURS') or resolution_action is not null);

-- Source line of the CSV row, so "first" and "latest" mean the same thing every time.
alter table public.timesheets add column source_line int not null default 0 check (source_line >= 0);
alter table public.leave_records add column source_line int not null default 0 check (source_line >= 0);
alter table public.actual_payments add column source_line int not null default 0 check (source_line >= 0);

-- Evidence is the same, plus the line (replaces the function from the import migration).
create or replace function public.save_import(p_batch jsonb, p_table text, p_rows jsonb) returns int
language plpgsql set search_path = '' as $$
declare n int;
begin
  insert into public.import_batches (id, company_id, run_id, import_type, source_provider, content_hash, mapping, row_count, rejected_count, rejected, created_by)
  select id, company_id, run_id, import_type, source_provider, content_hash, mapping, row_count, rejected_count, rejected, created_by
  from jsonb_populate_record(null::public.import_batches, p_batch);

  if p_table = 'timesheets' then
    with ins as (
      insert into public.timesheets (id, company_id, run_id, import_batch_id, worker_id, work_date, hours, approved_extra_hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line)
      select id, company_id, run_id, import_batch_id, worker_id, work_date, hours, approved_extra_hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line
      from jsonb_populate_recordset(null::public.timesheets, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  elsif p_table = 'leave_records' then
    with ins as (
      insert into public.leave_records (id, company_id, run_id, import_batch_id, worker_id, leave_date, leave_type, hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line)
      select id, company_id, run_id, import_batch_id, worker_id, leave_date, leave_type, hours, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line
      from jsonb_populate_recordset(null::public.leave_records, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  elsif p_table = 'actual_payments' then
    with ins as (
      insert into public.actual_payments (id, company_id, run_id, import_batch_id, worker_id, amount_enc, currency, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line)
      select id, company_id, run_id, import_batch_id, worker_id, amount_enc, currency, source_provider, object_type, object_id, fetched_at, source_hash, occurrence, source_line
      from jsonb_populate_recordset(null::public.actual_payments, p_rows)
      on conflict (company_id, run_id, source_hash, occurrence) do nothing returning 1)
    select count(*) into n from ins;
  else
    raise exception 'unknown evidence table' using errcode = 'P0001';
  end if;
  return n;
end $$;

-- A resolved exception never changes and is never deleted (S19, audit trail).
create function public.exceptions_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('RESOLVED', 'REJECTED') then raise exception 'a resolved exception cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status in ('RESOLVED', 'REJECTED')
     and (new.category, new.worker_id, new.run_id, new.evidence, new.options, new.dedupe_key, new.resolution, new.resolution_action, new.resolved_by, new.resolved_at)
     is distinct from (old.category, old.worker_id, old.run_id, old.evidence, old.options, old.dedupe_key, old.resolution, old.resolution_action, old.resolved_by, old.resolved_at) then
    raise exception 'a resolved exception is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger exceptions_guard before update or delete on public.exceptions for each row execute function public.exceptions_guard();
revoke all on function public.exceptions_guard() from public, anon, authenticated;

-- Rule 14 backstop: a run cannot reach READY_FOR_CALCULATION or CALCULATED while a reconciliation exception is open.
create function public.runs_block_on_open_exceptions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('READY_FOR_CALCULATION', 'CALCULATED') and new.status is distinct from old.status
     and exists (select 1 from public.exceptions e where e.company_id = new.company_id and e.run_id = new.id
                 and e.status in ('OPEN', 'IN_REVIEW', 'ESCALATED')
                 and e.category in ('DUPLICATE_TIMESHEET', 'LEAVE_WORK_CONFLICT', 'UNAPPROVED_OVERTIME', 'UNEXPLAINED_MISSING_HOURS')) then
    raise exception 'open exceptions block calculation' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payroll_runs_open_exceptions before update of status on public.payroll_runs for each row execute function public.runs_block_on_open_exceptions();
revoke all on function public.runs_block_on_open_exceptions() from public, anon, authenticated;

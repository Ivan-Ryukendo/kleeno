-- P3 slice 4: variance findings (SIMULATION value). Amounts reveal pay levels, so they are encrypted (S41); rows are immutable.
create table public.variance_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  run_id uuid not null,
  calculation_id uuid not null,
  worker_id uuid not null,
  kind text not null check (kind in ('UNDERPAID', 'OVERPAID', 'NOT_PAID', 'NOT_IN_PAYROLL')),
  detail_enc text not null, -- {expected, actual, difference} in micro-USDC
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (calculation_id, worker_id), -- one finding per worker per calculation: re-running cannot duplicate
  foreign key (company_id, run_id) references public.payroll_runs (company_id, id),
  foreign key (company_id, calculation_id) references public.calculations (company_id, id),
  foreign key (company_id, worker_id) references public.workers (company_id, id)
);
create index variance_findings_run_idx on public.variance_findings (company_id, run_id);

create trigger variance_findings_immutable before update or delete on public.variance_findings for each row execute function public.forbid_change();
create trigger variance_findings_no_truncate before truncate on public.variance_findings for each statement execute function public.forbid_change();
alter table public.variance_findings enable row level security;
revoke all on public.variance_findings from anon, authenticated;
grant select on public.variance_findings to authenticated;
grant all on public.variance_findings to service_role;
create policy variance_findings_select_own_company on public.variance_findings for select to authenticated using (company_id = (select public.current_company_id()));

-- P3 slice 1: AI executions (rule 5, S19) and the AI link on configurations.

create table public.ai_executions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  operation text not null check (operation in ('POLICY_INTERPRET', 'MAPPING_SUGGEST', 'RECON_CLASSIFY', 'VIEW_PROPOSE', 'WORKER_PROPOSE', 'PAYMENT_PLAN')),
  correlation_id text not null,
  input_ref text not null, -- an entity ID or a hash; never the input itself
  schema_version text not null,
  prompt_version text not null,
  provider text not null,
  model text,
  output jsonb, -- structured result only (rule IDs, enums, percentages, short plain-text reasons)
  validation jsonb not null default '{}'::jsonb, -- problems and flags; no payroll values (S45)
  retries int not null check (retries between 0 and 2),
  status text not null check (status in ('ACCEPTED', 'REPAIRED', 'NEEDS_HUMAN_REVIEW')),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index ai_executions_company_idx on public.ai_executions (company_id, created_at desc);

create trigger ai_executions_immutable before update or delete on public.ai_executions for each row execute function public.forbid_change();
create trigger ai_executions_no_truncate before truncate on public.ai_executions for each statement execute function public.forbid_change();

alter table public.ai_executions enable row level security;
revoke all on public.ai_executions from anon, authenticated;
grant select on public.ai_executions to authenticated;
grant all on public.ai_executions to service_role;
create policy ai_executions_select_own_company on public.ai_executions for select to authenticated using (company_id = (select public.current_company_id()));

-- A config proposed by the AI links to its execution; `validation` keeps the problems and the flagged values HR must confirm.
alter table public.payroll_configurations add column ai_execution_id uuid;
alter table public.payroll_configurations add column validation jsonb not null default '{}'::jsonb;
alter table public.payroll_configurations add foreign key (company_id, ai_execution_id) references public.ai_executions (company_id, id);

-- Approved versions stay immutable, now including the validation log and AI link (S19).
create or replace function public.payroll_configurations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('APPROVED', 'ACTIVE', 'SUPERSEDED') then raise exception 'an approved config cannot be deleted' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status in ('APPROVED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')
     and (new.id, new.company_id, new.version, new.params, new.clauses_enc, new.approved_by, new.approved_at, new.ai_execution_id, new.validation)
     is distinct from (old.id, old.company_id, old.version, old.params, old.clauses_enc, old.approved_by, old.approved_at, old.ai_execution_id, old.validation) then
    raise exception 'an approved config version is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

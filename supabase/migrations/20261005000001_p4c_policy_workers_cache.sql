-- P4c: confidential policy provenance/scopes, worker metadata and tenant-bound AI proposal cache.
alter table public.workers add column metadata_enc text;
alter table public.workers add column employment_start date;
alter table public.workers add column employment_end date;
alter table public.workers add constraint workers_employment_dates check (employment_start is null or employment_end is null or employment_end >= employment_start);
alter table public.payroll_configurations add column params_enc text;
alter table public.payroll_configurations add column documents_enc text;
alter table public.ai_executions add column output_enc text;

create or replace function public.payroll_configurations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'config versions cannot be deleted' using errcode = 'P0001'; end if;
  if old.status in ('APPROVED','ACTIVE','SUPERSEDED','ARCHIVED') and
    (new.id,new.company_id,new.version,new.params,new.params_enc,new.clauses_enc,new.documents_enc,new.approved_by,new.approved_at,new.ai_execution_id,new.validation)
    is distinct from
    (old.id,old.company_id,old.version,old.params,old.params_enc,old.clauses_enc,old.documents_enc,old.approved_by,old.approved_at,old.ai_execution_id,old.validation)
  then raise exception 'an approved config version is immutable' using errcode = 'P0001'; end if;
  return new;
end $$;

create table public.policy_proposal_cache (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  cache_key text not null check (length(cache_key) = 64),
  clause_hash text not null check (length(clause_hash) = 64),
  provider text not null,
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  execution_id uuid not null,
  payload_enc text not null,
  created_at timestamptz not null default now(),
  unique(company_id,cache_key),
  unique(company_id,id),
  foreign key(company_id,execution_id) references public.ai_executions(company_id,id)
);
alter table public.policy_proposal_cache enable row level security;
revoke all on public.policy_proposal_cache from anon, authenticated;
grant select on public.policy_proposal_cache to authenticated;
grant all on public.policy_proposal_cache to service_role;
create policy policy_proposal_cache_own_company on public.policy_proposal_cache for select to authenticated using(company_id = (select public.current_company_id()));
create trigger policy_proposal_cache_immutable before update or delete on public.policy_proposal_cache for each row execute function public.forbid_change();
create trigger policy_proposal_cache_no_truncate before truncate on public.policy_proposal_cache for each statement execute function public.forbid_change();

-- P4c HR amounts are run/worker-bound, encrypted, and frozen before the immutable calculation is saved.
alter table public.payroll_runs add column adjustment_revision integer not null default 0 check(adjustment_revision >= 0);
create table public.run_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_id uuid not null,
  worker_id uuid not null,
  payload_enc text not null,
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,run_id,worker_id),
  foreign key(company_id,run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,worker_id) references public.workers(company_id,id),
  foreign key(company_id,created_by) references public.memberships(company_id,user_id)
);
alter table public.run_adjustments enable row level security;
revoke all on public.run_adjustments from anon, authenticated;
grant select on public.run_adjustments to authenticated;
grant all on public.run_adjustments to service_role;
create policy run_adjustments_own_company on public.run_adjustments for select to authenticated using(company_id = (select public.current_company_id()));
create function public.run_adjustments_guard() returns trigger
language plpgsql set search_path = '' as $$
declare state_ text; roles_ text[];
begin
  if tg_op = 'DELETE' then raise exception 'adjustment records are retained' using errcode='P0001'; end if;
  select status into state_ from public.payroll_runs where company_id = new.company_id and id = new.run_id for update;
  if state_ is null or state_ not in ('DRAFT','DATA_IMPORTED','RECONCILING','EXCEPTIONS_PENDING','READY_FOR_CALCULATION') or exists(select 1 from public.calculations where company_id=new.company_id and run_id=new.run_id)
  then raise exception 'calculated run inputs are immutable; create a new run' using errcode='P0001'; end if;
  select roles into roles_ from public.memberships where company_id=new.company_id and user_id=new.created_by and removed_at is null;
  if roles_ is null or not (roles_ && array['HR_APPROVER','PAYROLL_APPROVER']) then raise exception 'only HR or payroll enters adjustments' using errcode='P0001'; end if;
  if tg_op='UPDATE' and (new.id,new.company_id,new.run_id,new.worker_id) is distinct from (old.id,old.company_id,old.run_id,old.worker_id) then raise exception 'adjustment identity is immutable' using errcode='P0001'; end if;
  update public.payroll_runs set adjustment_revision=adjustment_revision+1 where id=new.run_id and company_id=new.company_id;
  return new;
end $$;
create trigger run_adjustments_guard before insert or update or delete on public.run_adjustments for each row execute function public.run_adjustments_guard();
create trigger run_adjustments_no_truncate before truncate on public.run_adjustments for each statement execute function public.forbid_change();
revoke all on function public.run_adjustments_guard() from public, anon, authenticated;

create or replace function public.save_calculation(p_calc jsonb, p_lines jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare revision_ int;
begin
  select adjustment_revision into revision_ from public.payroll_runs where company_id=(p_calc->>'company_id')::uuid and id=(p_calc->>'run_id')::uuid for update;
  if revision_ is distinct from coalesce((p_calc->>'adjustment_revision')::int,0) then raise exception 'adjustments changed; calculate again' using errcode='P0001'; end if;
  insert into public.calculations(id,company_id,run_id,config_version,calculation_hash,snapshot_enc)
  values((p_calc->>'id')::uuid,(p_calc->>'company_id')::uuid,(p_calc->>'run_id')::uuid,(p_calc->>'config_version')::int,p_calc->>'calculation_hash',p_calc->>'snapshot_enc');
  insert into public.calculation_lines(id,company_id,calculation_id,worker_id,net,gross_enc,deductions_enc,trace_enc)
  select (l->>'id')::uuid,(l->>'company_id')::uuid,(l->>'calculation_id')::uuid,(l->>'worker_id')::uuid,(l->>'net')::bigint,l->>'gross_enc',l->>'deductions_enc',l->>'trace_enc' from jsonb_array_elements(p_lines) l;
end $$;
revoke all on function public.save_calculation(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_calculation(jsonb,jsonb) to service_role;

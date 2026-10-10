-- Immutable review/handoff lineage only. Replacement SIMULATION cannot create payment obligations.
-- Recovery: disable the route; preserve correction history and original signed evidence.
create table public.review_corrections (
  id uuid primary key, company_id uuid not null references public.companies(id),
  original_run_id uuid not null, replacement_run_id uuid not null,
  original_calculation_id uuid not null, replacement_calculation_id uuid not null,
  original_calculation_hash text not null check(original_calculation_hash ~ '^[a-f0-9]{64}$'),
  replacement_calculation_hash text not null check(replacement_calculation_hash ~ '^[a-f0-9]{64}$'),
  original_signoff_id uuid not null, actor_id uuid not null,
  original_review_revision integer not null check(original_review_revision>0),
  replacement_review_revision integer not null check(replacement_review_revision=0),
  payload_enc text not null check(length(payload_enc)>0), idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,original_run_id), unique(company_id,replacement_run_id), unique(company_id,idempotency_key),
  foreign key(company_id,original_run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,replacement_run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,original_calculation_id) references public.calculations(company_id,id),
  foreign key(company_id,replacement_calculation_id) references public.calculations(company_id,id),
  foreign key(company_id,original_signoff_id) references public.payroll_review_events(company_id,id),
  foreign key(company_id,actor_id) references public.memberships(company_id,user_id),
  check(original_run_id<>replacement_run_id and original_calculation_id<>replacement_calculation_id and original_calculation_hash<>replacement_calculation_hash)
);
alter table public.review_corrections enable row level security;
revoke all on public.review_corrections from public,anon,authenticated,service_role;
grant select on public.review_corrections to authenticated,service_role;
create policy review_corrections_select on public.review_corrections for select to authenticated using(
  company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=review_corrections.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER','PAYMENT_APPROVER']::text[])
);
create trigger review_corrections_immutable before update or delete on public.review_corrections for each row execute function public.forbid_change();
create trigger review_corrections_no_truncate before truncate on public.review_corrections for each statement execute function public.forbid_change();

create function public.link_review_correction(p_company uuid,p_run uuid,p_actor uuid,p_correlation text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original record; replacement record; oldcalc record; newcalc record; signed record; retry record; oldrev integer; newrev integer;
  target uuid:=(p_event->>'replacement_run_id')::uuid;
begin
  -- Existing lock order, with both run IDs sorted under the company lock.
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.payroll_runs where company_id=p_company and id in (p_run,target) order by id for update;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  select * into retry from public.review_corrections where company_id=p_company and idempotency_key=(p_event->>'idempotency_key')::uuid;
  if found then
    if retry.original_run_id<>p_run or retry.replacement_run_id<>target or retry.actor_id<>p_actor or retry.command_hash is distinct from p_event->>'command_hash' then return jsonb_build_object('code','CONFLICT'); end if;
    return jsonb_build_object('code','OK','id',retry.id);
  end if;
  select * into original from public.payroll_runs where company_id=p_company and id=p_run;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select * into replacement from public.payroll_runs where company_id=p_company and id=target;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if p_run=target or original.period_start<>replacement.period_start or original.period_end<>replacement.period_end
    or original.status not in ('CALCULATION_VALIDATED','PENDING_APPROVAL','APPROVED','OBLIGATIONS_CREATED','PAYMENT_IN_PROGRESS','PARTIALLY_SETTLED','PAYMENT_FAILED','SETTLED','RECONCILED')
    or replacement.mode<>'SIMULATION' or replacement.status<>'CALCULATION_VALIDATED' then return jsonb_build_object('code','CONFLICT'); end if;
  select * into oldcalc from public.calculations where company_id=p_company and run_id=p_run;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select * into newcalc from public.calculations where company_id=p_company and run_id=target;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if oldcalc.id is distinct from (p_event->>'original_calculation_id')::uuid or newcalc.id is distinct from (p_event->>'replacement_calculation_id')::uuid
    or oldcalc.calculation_hash is distinct from p_event->>'original_calculation_hash' or newcalc.calculation_hash is distinct from p_event->>'replacement_calculation_hash'
    or oldcalc.calculation_hash=newcalc.calculation_hash or oldcalc.config_version<>original.config_version or newcalc.config_version<>replacement.config_version then return jsonb_build_object('code','CONFLICT'); end if;
  select * into signed from public.payroll_review_events where company_id=p_company and run_id=p_run and action='SIGNOFF';
  if not found or signed.id is distinct from (p_event->>'original_signoff_id')::uuid or signed.calculation_id<>oldcalc.id or signed.calculation_hash<>oldcalc.calculation_hash then return jsonb_build_object('code','CONFLICT'); end if;
  select coalesce(max(revision),0) into oldrev from public.payroll_review_events where company_id=p_company and run_id=p_run;
  select coalesce(max(revision),0) into newrev from public.payroll_review_events where company_id=p_company and run_id=target;
  if oldrev is distinct from (p_event->>'original_review_revision')::integer or newrev<>0 or (p_event->>'replacement_review_revision')::integer is distinct from 0 then return jsonb_build_object('code','CONFLICT'); end if;
  if exists(select 1 from public.review_corrections where company_id=p_company and (original_run_id=p_run or replacement_run_id=target)) then return jsonb_build_object('code','CONFLICT'); end if;
  if exists(with recursive descendants(id) as (
    select replacement_run_id from public.review_corrections where company_id=p_company and original_run_id=target
    union select c.replacement_run_id from public.review_corrections c join descendants d on c.original_run_id=d.id where c.company_id=p_company
  ) select 1 from descendants where id=p_run) then return jsonb_build_object('code','CONFLICT'); end if;
  insert into public.review_corrections(id,company_id,original_run_id,replacement_run_id,original_calculation_id,replacement_calculation_id,original_calculation_hash,replacement_calculation_hash,original_signoff_id,actor_id,original_review_revision,replacement_review_revision,payload_enc,idempotency_key,command_hash)
    values((p_event->>'id')::uuid,p_company,p_run,target,oldcalc.id,newcalc.id,oldcalc.calculation_hash,newcalc.calculation_hash,signed.id,p_actor,oldrev,0,p_event->>'payload_enc',(p_event->>'idempotency_key')::uuid,p_event->>'command_hash');
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'review.correction_linked','review_correction',(p_event->>'id')::uuid,p_actor::text,'user',p_correlation,jsonb_build_object('originalRunId',p_run,'replacementRunId',target,'originalCalculationId',oldcalc.id,'replacementCalculationId',newcalc.id,'originalCalculationHash',oldcalc.calculation_hash,'replacementCalculationHash',newcalc.calculation_hash,'originalSignoffId',signed.id));
  return jsonb_build_object('code','OK','id',p_event->>'id');
end $$;
revoke all on function public.link_review_correction(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.link_review_correction(uuid,uuid,uuid,text,jsonb) to service_role;

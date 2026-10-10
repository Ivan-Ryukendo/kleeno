-- Optional effective compensation. Immutable history, encrypted rates/reason/source, pinned original baseline.
-- Existing snapshots and financial records are never rewritten. Disable scheduling routes to stop new history.
create table public.effective_compensations (
  id uuid primary key, company_id uuid not null references public.companies(id), worker_id uuid not null,
  revision integer not null check(revision between 1 and 10000), effective_from date not null check(effective_from between date '0001-01-01' and date '9999-12-31'),
  pay_type text not null check(pay_type in ('SALARIED','HOURLY','RETAINER')),
  baseline_compensation_id uuid not null, baseline_compensation_version integer not null check(baseline_compensation_version>0),
  supersedes_id uuid, payload_enc text not null check(length(payload_enc)>0), actor_id uuid not null,
  idempotency_key uuid not null, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,worker_id,id), unique(company_id,worker_id,revision), unique(company_id,idempotency_key),
  unique(company_id,supersedes_id), check(supersedes_id is null or supersedes_id<>id),
  foreign key(company_id,worker_id) references public.workers(company_id,id),
  foreign key(company_id,baseline_compensation_id) references public.compensations(company_id,id),
  foreign key(company_id,worker_id,supersedes_id) references public.effective_compensations(company_id,worker_id,id),
  foreign key(company_id,actor_id) references public.memberships(company_id,user_id)
);
create index effective_compensations_dates on public.effective_compensations(company_id,worker_id,effective_from);
create index effective_compensations_baseline on public.effective_compensations(company_id,baseline_compensation_id);
create index effective_compensations_actor on public.effective_compensations(company_id,actor_id);
alter table public.effective_compensations enable row level security;
revoke all on public.effective_compensations from public,anon,authenticated,service_role;
grant select on public.effective_compensations to authenticated,service_role;
create policy effective_compensations_select on public.effective_compensations for select to authenticated using(
  company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=effective_compensations.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER','PAYMENT_APPROVER']::text[])
);
create trigger effective_compensations_immutable before update or delete on public.effective_compensations for each row execute function public.forbid_change();
create trigger effective_compensations_no_truncate before truncate on public.effective_compensations for each statement execute function public.forbid_change();

create function public.schedule_effective_compensation(p_company uuid,p_worker uuid,p_actor uuid,p_correlation text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare worker_ record; baseline_ record; first_ record; previous_ record; retry_ record; revision_ integer; date_ date:=(p_event->>'effective_from')::date;
  actual_impacts uuid[]; expected_impacts uuid[]; superseded_ uuid:=(p_event->>'supersedes_id')::uuid;
begin
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select * into worker_ from public.workers where company_id=p_company and id=p_worker for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  select * into retry_ from public.effective_compensations where company_id=p_company and idempotency_key=(p_event->>'idempotency_key')::uuid;
  if found then
    if retry_.worker_id<>p_worker or retry_.actor_id<>p_actor or retry_.command_hash is distinct from p_event->>'command_hash' then return jsonb_build_object('code','CONFLICT'); end if;
    return jsonb_build_object('code','OK','id',retry_.id,'revision',retry_.revision);
  end if;
  select coalesce(max(revision),0) into revision_ from public.effective_compensations where company_id=p_company and worker_id=p_worker;
  if not worker_.active or revision_>=10000 or revision_ is distinct from (p_event->>'expected_revision')::integer or worker_.pay_type is distinct from p_event->>'pay_type' then return jsonb_build_object('code','CONFLICT'); end if;
  select * into first_ from public.effective_compensations where company_id=p_company and worker_id=p_worker and revision=1;
  if found then
    if first_.baseline_compensation_id is distinct from (p_event->>'baseline_compensation_id')::uuid or first_.baseline_compensation_version is distinct from (p_event->>'baseline_compensation_version')::integer or first_.pay_type<>worker_.pay_type then return jsonb_build_object('code','CONFLICT'); end if;
  else
    select * into baseline_ from public.compensations where company_id=p_company and worker_id=p_worker order by version desc limit 1;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    if baseline_.id is distinct from (p_event->>'baseline_compensation_id')::uuid or baseline_.version is distinct from (p_event->>'baseline_compensation_version')::integer then return jsonb_build_object('code','CONFLICT'); end if;
  end if;
  if date_ is null then return jsonb_build_object('code','CONFLICT'); end if;
  select array_agg(id order by id) into actual_impacts from public.payroll_runs where company_id=p_company and period_end>=date_;
  select array_agg(value::uuid order by value::uuid) into expected_impacts from jsonb_array_elements_text(p_event->'impacted_run_ids');
  if coalesce(actual_impacts,'{}'::uuid[]) is distinct from coalesce(expected_impacts,'{}'::uuid[]) then return jsonb_build_object('code','CONFLICT'); end if;
  select * into previous_ from public.effective_compensations e where e.company_id=p_company and e.worker_id=p_worker and e.effective_from=date_
    and not exists(select 1 from public.effective_compensations later where later.company_id=p_company and later.supersedes_id=e.id);
  if found then
    if previous_.id is distinct from superseded_ then return jsonb_build_object('code','CONFLICT'); end if;
  elsif superseded_ is not null then return jsonb_build_object('code','CONFLICT'); end if;
  insert into public.effective_compensations(id,company_id,worker_id,revision,effective_from,pay_type,baseline_compensation_id,baseline_compensation_version,supersedes_id,payload_enc,actor_id,idempotency_key,command_hash)
    values((p_event->>'id')::uuid,p_company,p_worker,revision_+1,date_,worker_.pay_type,(p_event->>'baseline_compensation_id')::uuid,(p_event->>'baseline_compensation_version')::integer,superseded_,p_event->>'payload_enc',p_actor,(p_event->>'idempotency_key')::uuid,p_event->>'command_hash');
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'compensation.scheduled','worker',p_worker,p_actor::text,'user',p_correlation,jsonb_build_object('scheduleId',p_event->>'id','revision',revision_+1,'baselineCompensationId',p_event->>'baseline_compensation_id','supersedesId',superseded_));
  return jsonb_build_object('code','OK','id',p_event->>'id','revision',revision_+1);
end $$;
revoke all on function public.schedule_effective_compensation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.schedule_effective_compensation(uuid,uuid,uuid,text,jsonb) to service_role;

-- First schedule and immediate compensation inserts serialize on company then worker. A timeline never mixes with a moving latest-rate path.
create function public.immediate_compensation_schedule_guard() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from public.companies where id=new.company_id for update;
  perform 1 from public.workers where company_id=new.company_id and id=new.worker_id for update;
  if exists(select 1 from public.effective_compensations where company_id=new.company_id and worker_id=new.worker_id) then raise exception 'scheduled worker requires effective compensation history' using errcode='P0001'; end if;
  return new;
end $$;
create trigger immediate_compensation_schedule_guard before insert on public.compensations for each row execute function public.immediate_compensation_schedule_guard();
revoke all on function public.immediate_compensation_schedule_guard() from public,anon,authenticated;
create function public.scheduled_worker_pay_type_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if new.pay_type is distinct from old.pay_type and exists(select 1 from public.effective_compensations where company_id=old.company_id and worker_id=old.id) then raise exception 'effective compensation does not permit mixed pay types' using errcode='P0001'; end if;
  return new;
end $$;
create trigger scheduled_worker_pay_type_guard before update of pay_type on public.workers for each row execute function public.scheduled_worker_pay_type_guard();
revoke all on function public.scheduled_worker_pay_type_guard() from public,anon,authenticated;

-- Bind the captured timeline revision at commit; no new fields are inserted into legacy encrypted snapshots.
create or replace function public.save_calculation(p_calc jsonb,p_lines jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare revision_ integer; expected_ jsonb; item_ record; actual_ integer;
begin
  perform 1 from public.companies where id=(p_calc->>'company_id')::uuid for update;
  select adjustment_revision into revision_ from public.payroll_runs where company_id=(p_calc->>'company_id')::uuid and id=(p_calc->>'run_id')::uuid for update;
  if revision_ is distinct from coalesce((p_calc->>'adjustment_revision')::integer,0) then raise exception 'adjustments changed; calculate again' using errcode='P0001'; end if;
  expected_:=p_calc->'compensation_revisions';
  if expected_ is not null then
    perform 1 from public.memberships where company_id=(p_calc->>'company_id')::uuid and user_id=(p_calc->>'actor_id')::uuid and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
    if not found then raise exception 'current payroll membership is required to capture effective compensation' using errcode='P0001'; end if;
    if jsonb_typeof(expected_)<>'object' then raise exception 'invalid compensation revision guard' using errcode='P0001'; end if;
    for item_ in select key,value from jsonb_each_text(expected_) loop
      select coalesce(max(revision),0) into actual_ from public.effective_compensations where company_id=(p_calc->>'company_id')::uuid and worker_id=item_.key::uuid;
      if actual_ is distinct from item_.value::integer then raise exception 'effective compensation changed; calculate again' using errcode='P0001'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(p_lines) l where not (expected_ ? (l->>'worker_id'))) then raise exception 'missing compensation revision guard' using errcode='P0001'; end if;
  elsif exists(select 1 from public.effective_compensations e join jsonb_array_elements(p_lines) l on e.worker_id=(l->>'worker_id')::uuid where e.company_id=(p_calc->>'company_id')::uuid) then
    raise exception 'scheduled calculation requires compensation revision guard' using errcode='P0001';
  end if;
  insert into public.calculations(id,company_id,run_id,config_version,calculation_hash,snapshot_enc)
    values((p_calc->>'id')::uuid,(p_calc->>'company_id')::uuid,(p_calc->>'run_id')::uuid,(p_calc->>'config_version')::integer,p_calc->>'calculation_hash',p_calc->>'snapshot_enc');
  insert into public.calculation_lines(id,company_id,calculation_id,worker_id,net,gross_enc,deductions_enc,trace_enc)
    select (l->>'id')::uuid,(l->>'company_id')::uuid,(l->>'calculation_id')::uuid,(l->>'worker_id')::uuid,(l->>'net')::bigint,l->>'gross_enc',l->>'deductions_enc',l->>'trace_enc' from jsonb_array_elements(p_lines) l;
end $$;
revoke all on function public.save_calculation(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_calculation(jsonb,jsonb) to service_role;

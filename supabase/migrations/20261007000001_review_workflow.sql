-- Commercial review is an append-only evidence workflow, never payroll/payment authority.
-- Recovery: retain events/manifests; disable these routes to roll back application use. No old migration is rewritten.
create table public.payroll_review_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  run_id uuid not null,
  calculation_id uuid not null,
  calculation_hash text not null check(calculation_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null check(revision > 0),
  action text not null check(action in ('SIGNOFF','EXPORT','ACKNOWLEDGE')),
  actor_id uuid not null,
  related_id uuid,
  idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
  payload_enc text,
  created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,run_id,revision), unique(company_id,idempotency_key),
  foreign key(company_id,run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,calculation_id) references public.calculations(company_id,id),
  foreign key(company_id,actor_id) references public.memberships(company_id,user_id),
  foreign key(company_id,related_id) references public.payroll_review_events(company_id,id),
  check((action='SIGNOFF' and payload_enc is null and related_id is null) or (action<>'SIGNOFF' and payload_enc is not null and length(payload_enc)>0 and related_id is not null))
);
create unique index payroll_review_one_signoff on public.payroll_review_events(company_id,run_id) where action='SIGNOFF';
create unique index payroll_review_one_export on public.payroll_review_events(company_id,run_id) where action='EXPORT';
alter table public.payroll_review_events enable row level security;
revoke all on public.payroll_review_events from public,anon,authenticated,service_role;
grant select on public.payroll_review_events to authenticated,service_role;
create policy payroll_review_select on public.payroll_review_events for select to authenticated using(company_id=(select public.current_company_id()));
create trigger payroll_review_immutable before update or delete on public.payroll_review_events for each row execute function public.forbid_change();
create trigger payroll_review_no_truncate before truncate on public.payroll_review_events for each statement execute function public.forbid_change();

-- Settings are created by the following additive migration. Their SQL is resolved on first invocation.
-- Lock order matches settings writes: company -> run -> current membership. Retry keys bind actor and payload.
create function public.append_payroll_review(p_company uuid,p_run uuid,p_actor uuid,p_correlation text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; c record; s record; batch record; prior record; current_revision integer;
  act text:=p_event->>'action'; related uuid; required_type text;
begin
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select status,config_version into r from public.payroll_runs where company_id=p_company and id=p_run for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null
    and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  select * into prior from public.payroll_review_events where company_id=p_company and idempotency_key=(p_event->>'idempotency_key')::uuid;
  if found then
    if prior.run_id<>p_run or prior.actor_id<>p_actor or prior.action is distinct from act or prior.command_hash is distinct from (p_event->>'command_hash') then
      return jsonb_build_object('code','CONFLICT');
    end if;
    return jsonb_build_object('code','OK','id',prior.id);
  end if;
  if act is null or act not in ('SIGNOFF','EXPORT','ACKNOWLEDGE') then return jsonb_build_object('code','CONFLICT'); end if;
  select id,run_id,config_version,calculation_hash into c from public.calculations
    where company_id=p_company and id=(p_event->>'calculation_id')::uuid;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if c.run_id<>p_run or c.config_version<>r.config_version or c.calculation_hash is distinct from (p_event->>'calculation_hash') then
    return jsonb_build_object('code','CONFLICT');
  end if;
  if r.status not in ('CALCULATION_VALIDATED','PENDING_APPROVAL','APPROVED','OBLIGATIONS_CREATED','PAYMENT_IN_PROGRESS','PARTIALLY_SETTLED','PAYMENT_FAILED','SETTLED','RECONCILED') then
    return jsonb_build_object('code','NOT_READY');
  end if;
  select coalesce(max(revision),0) into current_revision from public.payroll_review_events where company_id=p_company and run_id=p_run;
  if current_revision is distinct from (p_event->>'expected_revision')::integer then return jsonb_build_object('code','CONFLICT'); end if;
  if act in ('SIGNOFF','EXPORT') then
    if exists(select 1 from public.exceptions where company_id=p_company and run_id=p_run and status in ('OPEN','IN_REVIEW','ESCALATED')) then
      return jsonb_build_object('code','NOT_READY');
    end if;
    select * into s from public.payroll_review_settings where company_id=p_company and run_id=p_run;
    if not found then return jsonb_build_object('code','NOT_READY'); end if;
    if s.revision is distinct from (p_event->>'settings_revision')::integer then return jsonb_build_object('code','CONFLICT'); end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=s.time_zone)
      or jsonb_typeof(s.required_types)<>'array' or jsonb_array_length(s.required_types)=0 then return jsonb_build_object('code','NOT_READY'); end if;
    for required_type in select jsonb_array_elements_text(s.required_types) loop
      if required_type not in ('TIMESHEETS','LEAVE','ACTUAL_PAID') then return jsonb_build_object('code','NOT_READY'); end if;
      select row_count,rejected_count,created_at into batch from public.import_batches
        where company_id=p_company and run_id=p_run and import_type=required_type order by created_at desc,id desc limit 1;
      if not found then return jsonb_build_object('code','NOT_READY'); end if;
      if batch.rejected_count<>0 or batch.row_count<=batch.rejected_count or batch.created_at>s.cutoff_at or batch.created_at>now()
        or (s.fresh_after is not null and batch.created_at<s.fresh_after) then return jsonb_build_object('code','NOT_READY'); end if;
    end loop;
  end if;
  if act='SIGNOFF' then
    if exists(select 1 from public.payroll_review_events where company_id=p_company and run_id=p_run and action='SIGNOFF') then return jsonb_build_object('code','CONFLICT'); end if;
  elsif act='EXPORT' then
    select id into related from public.payroll_review_events where company_id=p_company and run_id=p_run and calculation_id=c.id and action='SIGNOFF';
    if not found or exists(select 1 from public.payroll_review_events where company_id=p_company and run_id=p_run and action='EXPORT') then return jsonb_build_object('code','CONFLICT'); end if;
  else
    select id into related from public.payroll_review_events where company_id=p_company and run_id=p_run and calculation_id=c.id and action='EXPORT';
    if not found then return jsonb_build_object('code','CONFLICT'); end if;
  end if;
  insert into public.payroll_review_events(id,company_id,run_id,calculation_id,calculation_hash,revision,action,actor_id,related_id,idempotency_key,command_hash,payload_enc)
    values((p_event->>'id')::uuid,p_company,p_run,c.id,c.calculation_hash,current_revision+1,act,p_actor,related,(p_event->>'idempotency_key')::uuid,p_event->>'command_hash',p_event->>'payload_enc');
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'review.'||lower(act),'review', (p_event->>'id')::uuid,p_actor::text,'user',p_correlation,
      jsonb_build_object('runId',p_run,'calculationId',c.id,'calculationHash',c.calculation_hash,'version',current_revision+1,'action',act));
  return jsonb_build_object('code','OK','id',p_event->>'id');
end $$;
revoke all on function public.append_payroll_review(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_payroll_review(uuid,uuid,uuid,text,jsonb) to service_role;

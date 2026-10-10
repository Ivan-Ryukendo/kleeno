-- Explicit encrypted history-review policy versions; no payroll/payment authority.
-- Recovery: disable threshold writes, retain immutable evidence; existing company deletion discovers this table.
create table public.historical_threshold_versions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  run_id uuid not null,
  revision integer not null check(revision>0),
  created_by uuid not null,
  idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
  configuration_hash text not null check(configuration_hash ~ '^[a-f0-9]{64}$'),
  payload_enc text not null check(length(payload_enc)>0),
  created_at timestamptz not null default now(),
  unique(company_id,id),unique(company_id,run_id,revision),unique(company_id,idempotency_key),
  foreign key(company_id,run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,created_by) references public.memberships(company_id,user_id)
);
alter table public.historical_threshold_versions enable row level security;
revoke all on public.historical_threshold_versions from anon,authenticated;
grant select on public.historical_threshold_versions to authenticated;
grant all on public.historical_threshold_versions to service_role;
create policy historical_threshold_read on public.historical_threshold_versions for select to authenticated
  using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=historical_threshold_versions.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER','PAYMENT_APPROVER']::text[]));
create trigger historical_threshold_immutable before update or delete on public.historical_threshold_versions for each row execute function public.forbid_change();
create trigger historical_threshold_no_truncate before truncate on public.historical_threshold_versions for each statement execute function public.forbid_change();

create function public.append_historical_thresholds(p_company uuid,p_run uuid,p_actor uuid,p_id uuid,p_expected_revision integer,p_idempotency_key uuid,p_command_hash text,p_configuration_hash text,p_payload_enc text,p_correlation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.historical_threshold_versions%rowtype; current_revision integer;
begin
  -- Same company-first lock as append_payroll_review: sign-off freezes the exact last committed threshold version.
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  perform 1 from public.payroll_runs where company_id=p_company and id=p_run for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select * into prior from public.historical_threshold_versions where company_id=p_company and idempotency_key=p_idempotency_key;
  if found then
    if prior.run_id<>p_run or prior.created_by<>p_actor or prior.command_hash is distinct from p_command_hash or prior.configuration_hash is distinct from p_configuration_hash then return jsonb_build_object('code','CONFLICT'); end if;
    return jsonb_build_object('code','OK','id',prior.id,'revision',prior.revision);
  end if;
  if exists(select 1 from public.payroll_review_events where company_id=p_company and run_id=p_run and action='SIGNOFF') then return jsonb_build_object('code','FROZEN'); end if;
  select coalesce(max(revision),0) into current_revision from public.historical_threshold_versions where company_id=p_company and run_id=p_run;
  if p_expected_revision is distinct from current_revision or p_id is null or p_idempotency_key is null or p_command_hash is null or p_command_hash !~ '^[a-f0-9]{64}$' or p_configuration_hash is null or p_configuration_hash !~ '^[a-f0-9]{64}$' or coalesce(length(p_payload_enc),0)=0 or p_correlation is null then return jsonb_build_object('code','CONFLICT'); end if;
  insert into public.historical_threshold_versions(id,company_id,run_id,revision,created_by,idempotency_key,command_hash,configuration_hash,payload_enc)
    values(p_id,p_company,p_run,current_revision+1,p_actor,p_idempotency_key,p_command_hash,p_configuration_hash,p_payload_enc);
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'review.thresholds','payroll_run',p_run,p_actor::text,'user',p_correlation,jsonb_build_object('version',current_revision+1,'thresholdVersion',p_id,'thresholdHash',p_configuration_hash));
  return jsonb_build_object('code','OK','id',p_id,'revision',current_revision+1);
end $$;
revoke all on function public.append_historical_thresholds(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.append_historical_thresholds(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text) to service_role;

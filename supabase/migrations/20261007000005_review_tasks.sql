-- Owned review work records human coordination only; no payroll/payment state is changed.
-- Rollback application use by disabling routes; retain encrypted immutable task history.
create table public.review_task_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  run_id uuid not null,
  task_id uuid not null,
  revision integer not null check(revision>0),
  actor_id uuid not null,
  assignee_id uuid not null,
  due_at timestamptz not null,
  severity text not null check(severity in ('LOW','MEDIUM','HIGH')),
  status text not null check(status in ('OPEN','IN_PROGRESS','RESOLVED')),
  source_kind text not null check(source_kind in ('EXCEPTION','MISSING_EVIDENCE')),
  exception_id uuid,
  import_type text,
  payload_enc text not null check(length(payload_enc)>0),
  idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(company_id,run_id,id), unique(company_id,run_id,task_id,revision), unique(company_id,idempotency_key),
  foreign key(company_id,run_id) references public.payroll_runs(company_id,id),
  foreign key(company_id,run_id,task_id) references public.review_task_events(company_id,run_id,id),
  foreign key(company_id,actor_id) references public.memberships(company_id,user_id),
  foreign key(company_id,assignee_id) references public.memberships(company_id,user_id),
  foreign key(company_id,exception_id) references public.exceptions(company_id,id),
  check((source_kind='EXCEPTION' and exception_id is not null and import_type is null)
    or (source_kind='MISSING_EVIDENCE' and exception_id is null and import_type is not null and import_type in ('TIMESHEETS','LEAVE','ACTUAL_PAID'))),
  check((revision=1 and id=task_id and status='OPEN') or (revision>1 and id<>task_id))
);
alter table public.review_task_events enable row level security;
revoke all on public.review_task_events from public,anon,authenticated,service_role;
grant select on public.review_task_events to authenticated,service_role;
create policy review_task_select on public.review_task_events for select to authenticated using(
  company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m
    where m.company_id=review_task_events.company_id and m.user_id=(select auth.uid())
      and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[])
);
create trigger review_task_immutable before update or delete on public.review_task_events for each row execute function public.forbid_change();
create trigger review_task_no_truncate before truncate on public.review_task_events for each statement execute function public.forbid_change();

create function public.append_review_task(p_company uuid,p_run uuid,p_actor uuid,p_correlation text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous record; retry record; settings record; batch record; rev integer; source_kind text; source_exception uuid; source_import text;
  task uuid:=(p_event->>'task_id')::uuid; assignee uuid:=(p_event->>'assignee_id')::uuid;
begin
  -- Same lock order as settings/signoff: company -> run -> current memberships.
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.payroll_runs where company_id=p_company and id=p_run for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null
    and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  select * into retry from public.review_task_events where company_id=p_company and idempotency_key=(p_event->>'idempotency_key')::uuid;
  if found then
    if retry.run_id<>p_run or retry.actor_id<>p_actor or retry.task_id<>task or retry.command_hash is distinct from p_event->>'command_hash' then
      return jsonb_build_object('code','CONFLICT');
    end if;
    return jsonb_build_object('code','OK','id',retry.id);
  end if;
  -- Actor revocation blocks retries; identical committed commands survive later source/assignee changes.
  perform 1 from public.memberships where company_id=p_company and user_id=assignee and removed_at is null
    and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return jsonb_build_object('code','ASSIGNEE_UNAVAILABLE'); end if;
  if p_event->>'action' not in ('create','update') or p_event->>'action' is null then return jsonb_build_object('code','CONFLICT'); end if;
  select * into previous from public.review_task_events where company_id=p_company and run_id=p_run and task_id=task order by revision desc limit 1;
  rev:=coalesce(previous.revision,0);
  if rev is distinct from (p_event->>'expected_revision')::integer then return jsonb_build_object('code','CONFLICT'); end if;
  if p_event->>'action'='create' then
    if rev<>0 or (p_event->>'id')::uuid<>task or p_event->>'status' is distinct from 'OPEN' then return jsonb_build_object('code','CONFLICT'); end if;
    source_kind:=p_event->>'source_kind'; source_exception:=(p_event->>'exception_id')::uuid; source_import:=p_event->>'import_type';
    if source_kind='EXCEPTION' then
      if source_exception is null or source_import is not null then return jsonb_build_object('code','SOURCE_UNAVAILABLE'); end if;
      perform 1 from public.exceptions where company_id=p_company and run_id=p_run and id=source_exception and status in ('OPEN','IN_REVIEW','ESCALATED') for share;
      if not found then return jsonb_build_object('code','SOURCE_UNAVAILABLE'); end if;
    elsif source_kind='MISSING_EVIDENCE' then
      if source_exception is not null or source_import is null or source_import not in ('TIMESHEETS','LEAVE','ACTUAL_PAID') then return jsonb_build_object('code','SOURCE_UNAVAILABLE'); end if;
      select * into settings from public.payroll_review_settings where company_id=p_company and run_id=p_run;
      if not found or not (settings.required_types ? source_import) then return jsonb_build_object('code','SOURCE_UNAVAILABLE'); end if;
      select row_count,rejected_count,created_at into batch from public.import_batches
        where company_id=p_company and run_id=p_run and import_type=source_import order by created_at desc,id desc limit 1;
      if found and batch.row_count>batch.rejected_count and batch.rejected_count=0 and batch.created_at<=settings.cutoff_at
        and batch.created_at<=now() and (settings.fresh_after is null or batch.created_at>=settings.fresh_after) then
        return jsonb_build_object('code','SOURCE_UNAVAILABLE');
      end if;
    else return jsonb_build_object('code','SOURCE_UNAVAILABLE'); end if;
  else
    if rev=0 or p_event ? 'source_kind' or p_event ? 'exception_id' or p_event ? 'import_type' then return jsonb_build_object('code','CONFLICT'); end if;
    source_kind:=previous.source_kind; source_exception:=previous.exception_id; source_import:=previous.import_type;
  end if;
  insert into public.review_task_events(id,company_id,run_id,task_id,revision,actor_id,assignee_id,due_at,severity,status,source_kind,exception_id,import_type,payload_enc,idempotency_key,command_hash)
    values((p_event->>'id')::uuid,p_company,p_run,task,rev+1,p_actor,assignee,(p_event->>'due_at')::timestamptz,p_event->>'severity',p_event->>'status',source_kind,source_exception,source_import,p_event->>'payload_enc',(p_event->>'idempotency_key')::uuid,p_event->>'command_hash');
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'review_task.'||(p_event->>'action'),'review_task',task,p_actor::text,'user',p_correlation,
      jsonb_build_object('runId',p_run,'version',rev+1,'status',p_event->>'status','assigneeId',assignee));
  return jsonb_build_object('code','OK','id',p_event->>'id');
end $$;
revoke all on function public.append_review_task(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_review_task(uuid,uuid,uuid,text,jsonb) to service_role;

-- Immediate compensation and its pay type must become visible in the same transaction.
create function public.append_immediate_compensation(p_company uuid,p_worker uuid,p_actor uuid,p_correlation text,p_event jsonb)
returns text language plpgsql set search_path='' as $$
declare worker_ record; version_ integer; type_ text:=p_event->>'pay_type';
begin
  -- Match the company -> worker order used by effective compensation and its insert guard.
  perform 1 from public.companies where id=p_company for update;
  if not found then return 'NOT_FOUND'; end if;
  select active,pay_type into worker_ from public.workers where company_id=p_company and id=p_worker for update;
  if not found then return 'NOT_FOUND'; end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null
    and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return 'FORBIDDEN'; end if;
  if not worker_.active then return 'INVALID_TRANSITION'; end if;
  if exists(select 1 from public.effective_compensations where company_id=p_company and worker_id=p_worker) then return 'CONFLICT'; end if;
  select coalesce(max(version),0) into version_ from public.compensations where company_id=p_company and worker_id=p_worker;
  if version_ is distinct from (p_event->>'expected_version')::integer
    or (type_ is not null and type_ not in ('SALARIED','HOURLY','RETAINER'))
    or p_event->>'reason' is null or p_event->>'reason' not in ('PROMOTION','RAISE','ROLE_CHANGE','CORRECTION')
    or coalesce(length(p_event->>'payload_enc'),0)=0 then return 'CONFLICT'; end if;
  insert into public.compensations(id,company_id,worker_id,version,payload_enc,created_by,reason)
    values((p_event->>'id')::uuid,p_company,p_worker,version_+1,p_event->>'payload_enc',p_actor,p_event->>'reason');
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'compensation.version','worker',p_worker,p_actor::text,'user',p_correlation,jsonb_build_object('version',version_+1,'reason',p_event->>'reason'));
  if type_ is not null and type_<>worker_.pay_type then
    update public.workers set pay_type=type_ where company_id=p_company and id=p_worker;
    insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
      values(p_company,'worker.pay_type','worker',p_worker,p_actor::text,'user',p_correlation,jsonb_build_object('from',worker_.pay_type,'to',type_));
  end if;
  return 'OK';
end $$;
revoke all on function public.append_immediate_compensation(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_immediate_compensation(uuid,uuid,uuid,text,jsonb) to service_role;

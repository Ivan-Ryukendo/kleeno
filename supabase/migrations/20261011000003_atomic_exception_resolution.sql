-- Bind the encrypted human decision and terminal transition audit under one exception lock.
create function public.resolve_reconciliation_exception(p_company uuid,p_id uuid,p_actor uuid,p_correlation text,p_action text,p_resolution text)
returns text language plpgsql set search_path='' as $$
declare exception_ record;
begin
  perform 1 from public.companies where id=p_company for update;
  if not found then return 'NOT_FOUND'; end if;
  select * into exception_ from public.exceptions where company_id=p_company and id=p_id for update;
  if not found then return 'NOT_FOUND'; end if;
  perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null
    and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then return 'FORBIDDEN'; end if;
  if exception_.category not in ('UNEXPLAINED_MISSING_HOURS','DUPLICATE_TIMESHEET','UNAPPROVED_OVERTIME','LEAVE_WORK_CONFLICT')
    or p_action is null or not (exception_.options ? p_action) or coalesce(length(p_resolution),0)=0 then return 'FORBIDDEN'; end if;
  if exception_.status not in ('OPEN','IN_REVIEW') then return 'STALE_STATE'; end if;
  if exception_.status='OPEN' then
    if not public.cas_transition('exceptions',p_company,p_id,'OPEN','IN_REVIEW','exception','exception.start_review',p_actor::text,'user',p_correlation,jsonb_build_object('from','OPEN','to','IN_REVIEW'))
      then raise exception 'exception changed concurrently' using errcode='P0001'; end if;
  end if;
  update public.exceptions set resolution_action=p_action,resolution=p_resolution,resolved_by=p_actor,resolved_at=now()
    where company_id=p_company and id=p_id;
  if not public.cas_transition('exceptions',p_company,p_id,'IN_REVIEW','RESOLVED','exception','exception.resolve',p_actor::text,'user',p_correlation,
    jsonb_build_object('from','IN_REVIEW','to','RESOLVED','action',p_action,'runId',exception_.run_id))
    then raise exception 'exception changed concurrently' using errcode='P0001'; end if;
  return 'OK';
end $$;
revoke all on function public.resolve_reconciliation_exception(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.resolve_reconciliation_exception(uuid,uuid,uuid,text,text,text) to service_role;

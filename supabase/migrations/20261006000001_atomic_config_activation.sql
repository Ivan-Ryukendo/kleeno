-- S18/S19/S32/S61: replace the active version and audit both transitions in one transaction.
-- Lock the company first so simultaneous activations cannot supersede each other's target midway.
create function public.activate_payroll_config(p_company uuid, p_id uuid, p_actor uuid, p_correlation text)
returns text language plpgsql set search_path = '' as $$
declare target_status text; previous_id uuid;
begin
  perform 1 from public.companies where id = p_company for update;
  if not found then return 'NOT_FOUND'; end if;
  perform 1 from public.memberships
    where company_id = p_company and user_id = p_actor and removed_at is null
      and roles && array['HR_APPROVER', 'PAYROLL_APPROVER']::text[] for share;
  if not found then return 'FORBIDDEN'; end if;
  select status into target_status from public.payroll_configurations
    where company_id = p_company and id = p_id for update;
  if not found then return 'NOT_FOUND'; end if;
  if target_status <> 'APPROVED' then return 'INVALID_TRANSITION'; end if;
  select id into previous_id from public.payroll_configurations
    where company_id = p_company and status = 'ACTIVE' for update;
  if previous_id is not null then
    if not public.cas_transition('payroll_configurations', p_company, previous_id, 'ACTIVE', 'SUPERSEDED',
      'config', 'config.supersede', p_actor::text, 'user', p_correlation,
      jsonb_build_object('from', 'ACTIVE', 'to', 'SUPERSEDED')) then
      raise exception 'configuration changed concurrently' using errcode = 'P0001';
    end if;
  end if;
  if not public.cas_transition('payroll_configurations', p_company, p_id, 'APPROVED', 'ACTIVE',
    'config', 'config.activate', p_actor::text, 'user', p_correlation,
    jsonb_build_object('from', 'APPROVED', 'to', 'ACTIVE')) then
    raise exception 'configuration changed concurrently' using errcode = 'P0001';
  end if;
  return 'ACTIVE';
end $$;

revoke all on function public.activate_payroll_config(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.activate_payroll_config(uuid, uuid, uuid, text) to service_role;

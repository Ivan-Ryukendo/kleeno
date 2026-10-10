-- Read-only platform inventory, distinct from leads, workers, billing and adoption.
-- No authoritative test classification exists for users/companies: retain that unknown explicitly.
create function public.platform_account_inventory(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform 1 from growth.platform_admins where user_id=p_actor for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  -- One statement snapshot, so accounts in several companies and overlapping demo flags reconcile.
  with member_cohorts as (
    select m.user_id,bool_or(not (c.is_demo or c.is_sandbox)) as has_unmarked
    from public.memberships m join public.companies c on c.id=m.company_id
    where m.removed_at is null group by m.user_id
  ), accounts as (
    select count(*) as registered,count(mc.user_id) as active,
      count(*) filter(where mc.user_id is not null and not mc.has_unmarked) as demo_only,
      count(*) filter(where mc.has_unmarked) as unmarked,
      count(*) filter(where mc.user_id is null) as unassigned
    from auth.users u left join member_cohorts mc on mc.user_id=u.id
  ), companies as (
    select count(*) as total,count(*) filter(where is_demo) as demo,count(*) filter(where is_sandbox) as sandbox,
      count(*) filter(where is_demo or is_sandbox) as flagged,count(*) filter(where not (is_demo or is_sandbox)) as unmarked from public.companies
  ), memberships as (
    select count(*) as total,count(*) filter(where removed_at is null) as active,count(*) filter(where removed_at is not null) as removed from public.memberships
  ), workers as (
    select count(*) as total,count(*) filter(where c.is_demo or c.is_sandbox) as flagged,
      count(*) filter(where not (c.is_demo or c.is_sandbox)) as unmarked
    from public.workers w join public.companies c on c.id=w.company_id
  ), invitations as (
    select count(*) as total,count(*) filter(where used_at is null and revoked_at is null and expires_at>statement_timestamp()) as pending,
      count(*) filter(where used_at is null and revoked_at is null and expires_at<=statement_timestamp()) as expired,
      count(*) filter(where used_at is not null) as used,count(*) filter(where revoked_at is not null) as revoked from public.invites
  ), leads as (
    select count(*) as total,count(*) filter(where is_test) as marked_test,count(*) filter(where not is_test) as unmarked from growth.contacts
  )
  select jsonb_build_object(
    'scope','CURRENT_DATABASE_INVENTORY','asOf',statement_timestamp(),
    'accounts',jsonb_build_object('registered',a.registered,'withActiveMembership',a.active,'onlyDemoSandboxMemberships',a.demo_only,'unmarkedMemberships',a.unmarked,'withoutActiveMembership',a.unassigned,'testClassification','UNKNOWN'),
    'companies',jsonb_build_object('total',c.total,'demo',c.demo,'sandbox',c.sandbox,'demoOrSandbox',c.flagged,'unmarked',c.unmarked,'testClassification','UNKNOWN'),
    'memberships',jsonb_build_object('total',m.total,'active',m.active,'removed',m.removed),
    'workers',jsonb_build_object('total',w.total,'inDemoOrSandboxCompanies',w.flagged,'inUnmarkedCompanies',w.unmarked),
    'invitations',jsonb_build_object('total',i.total,'pending',i.pending,'expired',i.expired,'used',i.used,'revoked',i.revoked),
    'leads',jsonb_build_object('total',l.total,'markedTest',l.marked_test,'unmarked',l.unmarked),
    'commercial',jsonb_build_object('paidCompanies',null,'trials',null,'subscriptions',null,'activatedReviewers',null,'testExclusionsComplete',false)
  ) into result from accounts a cross join companies c cross join memberships m cross join workers w cross join invitations i cross join leads l;
  return result;
end $$;
revoke all on function public.platform_account_inventory(uuid) from public,anon,authenticated;
grant execute on function public.platform_account_inventory(uuid) to service_role;

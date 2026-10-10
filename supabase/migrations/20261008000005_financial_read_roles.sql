-- Raw payroll/recipient access is role-bound even through the direct public API.
-- Keep existing tenant/MFA policies; a restrictive policy intersects every permissive policy.
do $$
declare t text;
begin
  foreach t in array array['workers','calculation_lines','obligations','payment_batches'] loop
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (
      exists(select 1 from public.memberships m where m.company_id=%I.company_id
        and m.user_id=(select auth.uid()) and m.removed_at is null
        and m.roles && array[''HR_APPROVER'',''PAYROLL_APPROVER'',''PAYMENT_APPROVER'']::text[]))', t || '_financial_read_roles', t, t);
  end loop;
end $$;

-- Deliberately owner-run, fixed safe projections. Tenant/MFA checks remain inside
-- every security-barrier view because the owner bypasses raw-table role policies.
create view public.worker_directory with (security_barrier=true) as
  select id,company_id,pseudonym,pay_type,active,left_on from public.workers
  where company_id=(select public.current_company_id());
create view public.obligation_metadata with (security_barrier=true) as
  select id,company_id,run_id,worker_id,status,created_at,updated_at from public.obligations
  where company_id=(select public.current_company_id());
create view public.payment_batch_metadata with (security_barrier=true) as
  select id,company_id,run_id,status from public.payment_batches
  where company_id=(select public.current_company_id());
create view public.calculation_line_metadata with (security_barrier=true) as
  select l.id,l.company_id,l.calculation_id,l.worker_id,c.run_id,c.created_at
  from public.calculation_lines l join public.calculations c on c.company_id=l.company_id and c.id=l.calculation_id
  where l.company_id=(select public.current_company_id());
revoke all on public.worker_directory,public.obligation_metadata,public.payment_batch_metadata,public.calculation_line_metadata from public,anon,authenticated;
grant select on public.worker_directory,public.obligation_metadata,public.payment_batch_metadata,public.calculation_line_metadata to authenticated;

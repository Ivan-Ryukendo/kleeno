-- Close direct API paths around payroll table role masking. Existing tenant/MFA
-- policies remain mandatory; service payment/recovery repositories are unchanged.
do $$
declare t text;
begin
  foreach t in array array['payment_attempts','company_wallets'] loop
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (
      exists(select 1 from public.memberships m where m.company_id=%I.company_id
        and m.user_id=(select auth.uid()) and m.removed_at is null
        and m.roles && array[''HR_APPROVER'',''PAYROLL_APPROVER'',''PAYMENT_APPROVER'']::text[]))', t || '_financial_read_roles', t, t);
  end loop;
end $$;

-- Saved burn/operator signatures and attestations are server recovery material.
-- Owner/Payment Approver top-up APIs retain their deliberately limited projection.
revoke all on public.gateway_transfers from public, anon, authenticated;

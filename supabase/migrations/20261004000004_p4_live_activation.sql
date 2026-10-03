-- P4 slice 4: live-payments activation (S66, ARCHITECTURE 14.9). A company asks, the platform admin approves, wallets and the guard
-- are provisioned, and only then can the Owner switch live payments ON. The database enforces the path, service role included.

alter table public.companies add column live_status text not null default 'NOT_REQUESTED'
  check (live_status in ('NOT_REQUESTED', 'REQUESTED', 'APPROVED', 'PROVISIONED', 'REJECTED'));
alter table public.companies add column live_requested_by uuid;
alter table public.companies add column live_requested_at timestamptz;
alter table public.companies add column live_decided_by uuid; -- the platform admin (an auth user, not a company member)
alter table public.companies add column live_decided_at timestamptz;

-- Companies that were set up by script before this migration are already provisioned.
update public.companies c set live_status = 'PROVISIONED'
where c.guard_address is not null and not (c.is_demo or c.is_sandbox)
  and exists (select 1 from public.company_wallets w where w.company_id = c.id and w.role = 'APPROVER')
  and exists (select 1 from public.company_wallets w where w.company_id = c.id and w.role = 'AGENT');

-- Demo and sandbox companies can never ask (S64).
alter table public.companies add constraint companies_no_live_request_for_demo check (live_status = 'NOT_REQUESTED' or not (is_demo or is_sandbox));

create function public.companies_live_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not ((old.live_status, new.live_status) in (
      ('NOT_REQUESTED', 'REQUESTED'), ('REJECTED', 'REQUESTED'), ('REQUESTED', 'APPROVED'), ('REQUESTED', 'REJECTED'), ('APPROVED', 'PROVISIONED'))) then
    raise exception 'live status % -> % is not allowed', old.live_status, new.live_status using errcode = 'P0001';
  end if;
  if new.live_status = 'PROVISIONED' and (new.guard_address is null
      or not exists (select 1 from public.company_wallets w where w.company_id = new.id and w.role = 'APPROVER')
      or not exists (select 1 from public.company_wallets w where w.company_id = new.id and w.role = 'AGENT')) then
    raise exception 'a company is provisioned only with both wallets and a guard' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger companies_live_status_guard before update of live_status on public.companies
  for each row when (new.live_status is distinct from old.live_status) execute function public.companies_live_status_guard();
revoke all on function public.companies_live_status_guard() from public, anon, authenticated;

-- Switching ON (not OFF): the company is provisioned and has a payroll approver and a different payment approver.
create function public.companies_live_on_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.live_status is distinct from 'PROVISIONED' then
    raise exception 'live payments need an approved and provisioned company' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.memberships a join public.memberships b on b.company_id = a.company_id and b.user_id <> a.user_id
    where a.company_id = new.id and a.removed_at is null and b.removed_at is null
      and 'PAYROLL_APPROVER' = any (a.roles) and 'PAYMENT_APPROVER' = any (b.roles)) then
    raise exception 'live payments need a payroll approver and a different payment approver' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger companies_live_on_guard before update of live_payments_enabled on public.companies
  for each row when (new.live_payments_enabled and not old.live_payments_enabled) execute function public.companies_live_on_guard();
revoke all on function public.companies_live_on_guard() from public, anon, authenticated;

-- P4b: cap standing authorization amounts at 1e9 USDC (1e15 micro-USDC), below JS's exact integer limit.
-- Fail clearly if existing rows need review before enforcing the same boundary for future grants.
do $$
begin
  if exists (
    select 1 from public.standing_authorizations
    where max_batch_total > 1000000000000000 or max_per_payment > 1000000000000000
  ) then
    raise exception 'existing standing authorizations exceed the P4b exact amount ceiling';
  end if;
end $$;

alter table public.standing_authorizations
  add constraint standing_authorizations_amount_ceiling
  check (max_batch_total <= 1000000000000000 and max_per_payment <= 1000000000000000);

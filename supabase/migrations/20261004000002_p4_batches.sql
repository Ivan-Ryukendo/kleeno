-- P4 slice 2: batches, holds and signing (rules 22-24, S08, S09).

-- Once a batch names its authorizer or its guard run, neither can change (the signed plan stays the signed plan).
create or replace function public.payment_batches_guard() returns trigger
language plpgsql set search_path = '' as $$
declare approver uuid; authorizer_roles text[];
begin
  if tg_op = 'DELETE' then raise exception 'payment batches cannot be deleted' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.id, new.company_id, new.run_id, new.plan, new.plan_hash)
     is distinct from (old.id, old.company_id, old.run_id, old.plan, old.plan_hash) then
    raise exception 'the signed plan is immutable' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and ((old.authorizer_id is not null and new.authorizer_id is distinct from old.authorizer_id)
     or (old.guard_run_key is not null and new.guard_run_key is distinct from old.guard_run_key)) then
    raise exception 'the authorizer and the guard run of a batch cannot change' using errcode = 'P0001';
  end if;
  if new.status in ('AUTHORIZED', 'OPEN', 'COMPLETED', 'CLOSED') then
    select approver_id into approver from public.payroll_approvals where run_id = new.run_id and company_id = new.company_id;
    select m.roles into authorizer_roles from public.memberships m where m.user_id = new.authorizer_id and m.company_id = new.company_id and m.removed_at is null;
    if approver is null then raise exception 'no payroll approval for this run' using errcode = 'P0001'; end if;
    if approver = new.authorizer_id then raise exception 'authorizer must differ from the payroll approver' using errcode = 'P0001'; end if;
    if authorizer_roles is null or not ('PAYMENT_APPROVER' = any (authorizer_roles)) then raise exception 'authorizer lacks the payment role' using errcode = 'P0001'; end if;
  end if;
  return coalesce(new, old);
end $$;

-- An obligation becomes AUTHORIZED only inside a signed batch, so a hold is released only by a new signed batch (rule 24).
create function public.obligations_authorize_guard() returns trigger
language plpgsql set search_path = '' as $$
declare b text;
begin
  select status into b from public.payment_batches where id = new.batch_id and company_id = new.company_id and run_id = new.run_id;
  if b is null or b not in ('AUTHORIZED', 'OPEN') then
    raise exception 'an obligation is authorized only by a signed batch of its run' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger obligations_authorize_guard before update of status on public.obligations
  for each row when (new.status = 'AUTHORIZED' and old.status is distinct from 'AUTHORIZED') execute function public.obligations_authorize_guard();
revoke all on function public.obligations_authorize_guard() from public, anon, authenticated;

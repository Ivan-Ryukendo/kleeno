-- P4 slice 1: one obligation per calculation line (rule 49) and recipient-change confirmation (ARCHITECTURE 12, S16).
-- A worker's wallet may enter an obligation only when it equals the confirmed address. A system-made Circle wallet is
-- confirmed at creation; any other address needs a payment approver who is not the person who set it.

create unique index obligations_calculation_line_key on public.obligations (calculation_line_id);

alter table public.workers add column wallet_set_by uuid;
alter table public.workers add column wallet_confirmed_address text check (wallet_confirmed_address ~ '^0x[0-9a-fA-F]{40}$');
alter table public.workers add column wallet_confirmed_by uuid;
alter table public.workers add column wallet_confirmed_at timestamptz;
alter table public.workers add foreign key (company_id, wallet_set_by) references public.memberships (company_id, user_id);
alter table public.workers add foreign key (company_id, wallet_confirmed_by) references public.memberships (company_id, user_id);

-- Wallets the system created before this migration are already trusted.
update public.workers set wallet_confirmed_address = wallet_address, wallet_confirmed_at = now()
  where wallet_source = 'CIRCLE' and wallet_address is not null;

create function public.workers_wallet_guard() returns trigger
language plpgsql set search_path = '' as $$
declare roles_ text[];
begin
  if new.wallet_confirmed_address is not null and new.wallet_confirmed_address is distinct from old.wallet_confirmed_address then
    if new.wallet_confirmed_address is distinct from new.wallet_address then
      raise exception 'only the current wallet address can be confirmed' using errcode = 'P0001';
    end if;
    if new.wallet_confirmed_by is null then
      if new.wallet_source is distinct from 'CIRCLE' then raise exception 'an external address needs a confirming payment approver' using errcode = 'P0001'; end if;
    else
      if new.wallet_confirmed_by is not distinct from new.wallet_set_by then raise exception 'the person who set the address cannot confirm it' using errcode = 'P0001'; end if;
      select m.roles into roles_ from public.memberships m where m.user_id = new.wallet_confirmed_by and m.company_id = new.company_id and m.removed_at is null;
      if roles_ is null or not ('PAYMENT_APPROVER' = any (roles_)) then raise exception 'the confirmer lacks the payment role' using errcode = 'P0001'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger workers_wallet_guard before update on public.workers for each row execute function public.workers_wallet_guard();
revoke all on function public.workers_wallet_guard() from public, anon, authenticated;

-- Obligations (rules 15, 16) now also require the recipient to be the worker's confirmed wallet.
create or replace function public.obligations_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r record; a record; w record;
begin
  select mode, status into r from public.payroll_runs where id = new.run_id and company_id = new.company_id;
  select run_id, calculation_hash into a from public.payroll_approvals where id = new.approval_id and company_id = new.company_id;
  select wallet_address, wallet_confirmed_address into w from public.workers where id = new.worker_id and company_id = new.company_id;
  if r.mode is distinct from 'LIVE_TESTNET' or r.status not in ('APPROVED', 'OBLIGATIONS_CREATED') then
    raise exception 'obligations exist only for an approved LIVE_TESTNET run' using errcode = 'P0001';
  end if;
  if a.run_id is distinct from new.run_id or a.calculation_hash is distinct from new.calculation_hash then
    raise exception 'obligation must match its run approval' using errcode = 'P0001';
  end if;
  if lower(new.recipient) is distinct from lower(w.wallet_address) or lower(new.recipient) is distinct from lower(w.wallet_confirmed_address) then
    raise exception 'the recipient is not the worker''s confirmed wallet' using errcode = 'P0001';
  end if;
  return new;
end $$;

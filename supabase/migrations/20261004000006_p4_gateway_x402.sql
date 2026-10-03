-- P4 slice 6: Gateway top-up (S67) and Kleeno Verify / x402 (S68).
-- gateway_transfers: one row per top-up request, every step saved before the next (rule 26, 49). The recipient is the company's own
-- approver wallet and is checked by the database at insert and frozen afterwards, so no request or later edit can point it elsewhere.
-- x402_payments: one row per paid Kleeno Verify call; the buyer's EIP-3009 nonce is unique, so one signed payment buys one answer.

create table public.gateway_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  request_id uuid not null, -- the caller's idempotency key for the whole request
  requested_by uuid not null,
  amount bigint not null check (amount > 0 and amount <= 100000000), -- micro-USDC; per-request cap 100 USDC (S67)
  max_fee bigint not null check (max_fee > 0),
  source_chain text not null check (source_chain in ('BASE-SEPOLIA')),
  depositor text not null check (depositor ~ '^0x[0-9a-fA-F]{40}$'),
  recipient text not null check (recipient ~ '^0x[0-9a-fA-F]{40}$'),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'SOURCE_READY', 'APPROVED', 'DEPOSITED', 'CREDITED', 'ATTESTED', 'COMPLETE', 'FAILED')),
  source_wallet_id text,
  approve_tx_id text,
  deposit_tx_id text,
  burn_salt text check (burn_salt ~ '^0x[0-9a-f]{64}$'),
  burn_signature text,
  attestation text,
  operator_signature text,
  mint_tx_id text,
  mint_tx_hash text check (mint_tx_hash ~ '^0x[0-9a-f]{64}$'),
  failure text, -- a fixed code, never a raw error
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, request_id)
);
-- One top-up in flight per company: a second request resumes or waits, it never races the first.
create unique index gateway_transfers_one_active on public.gateway_transfers (company_id) where status not in ('COMPLETE', 'FAILED');

create function public.gateway_transfers_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  ranks text[] := array['REQUESTED', 'SOURCE_READY', 'APPROVED', 'DEPOSITED', 'CREDITED', 'ATTESTED', 'COMPLETE'];
  v_approver text;
begin
  if tg_op = 'INSERT' then
    select lower(address) into v_approver from public.company_wallets where company_id = new.company_id and role = 'APPROVER';
    if v_approver is null or lower(new.recipient) <> v_approver or lower(new.depositor) <> v_approver then
      raise exception 'a Gateway top-up can only go to the company''s own approver wallet' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.company_id <> old.company_id or new.request_id <> old.request_id or new.requested_by <> old.requested_by or new.amount <> old.amount
     or new.max_fee <> old.max_fee or new.source_chain <> old.source_chain or new.depositor <> old.depositor or new.recipient <> old.recipient then
    raise exception 'a Gateway top-up request cannot be changed' using errcode = 'P0001';
  end if;
  if old.status in ('COMPLETE', 'FAILED') and new.status <> old.status then
    raise exception 'a finished Gateway top-up cannot move' using errcode = 'P0001';
  end if;
  if new.status <> 'FAILED' and array_position(ranks, new.status) < array_position(ranks, old.status) then
    raise exception 'a Gateway top-up only moves forward' using errcode = 'P0001';
  end if;
  -- a saved step is never overwritten (a retry must reuse it)
  if (old.source_wallet_id is not null and new.source_wallet_id is distinct from old.source_wallet_id)
     or (old.approve_tx_id is not null and new.approve_tx_id is distinct from old.approve_tx_id)
     or (old.deposit_tx_id is not null and new.deposit_tx_id is distinct from old.deposit_tx_id)
     or (old.burn_salt is not null and new.burn_salt is distinct from old.burn_salt)
     or (old.burn_signature is not null and new.burn_signature is distinct from old.burn_signature)
     or (old.attestation is not null and new.attestation is distinct from old.attestation)
     or (old.mint_tx_id is not null and new.mint_tx_id is distinct from old.mint_tx_id) then
    raise exception 'a saved Gateway step cannot be replaced' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger gateway_transfers_guard before insert or update on public.gateway_transfers for each row execute function public.gateway_transfers_guard();
create trigger gateway_transfers_no_delete before delete on public.gateway_transfers for each row execute function public.forbid_change();
create trigger gateway_transfers_no_truncate before truncate on public.gateway_transfers for each statement execute function public.forbid_change();

create table public.x402_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  obligation_id uuid not null,
  nonce text not null check (nonce ~ '^0x[0-9a-f]{64}$'), -- the buyer's EIP-3009 authorization nonce
  payer text not null check (payer ~ '^0x[0-9a-f]{40}$'),
  amount bigint not null check (amount > 0),
  network text not null check (network = 'eip155:5042002'),
  status text not null default 'PENDING' check (status in ('PENDING', 'SETTLED', 'FAILED')),
  settlement_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nonce),
  unique (company_id, id),
  foreign key (company_id, obligation_id) references public.obligations (company_id, id)
);
create index x402_payments_company_idx on public.x402_payments (company_id, created_at);

create function public.x402_payments_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.company_id <> old.company_id or new.obligation_id <> old.obligation_id or new.nonce <> old.nonce or new.amount <> old.amount or new.network <> old.network then
    raise exception 'an x402 payment record cannot be changed' using errcode = 'P0001';
  end if;
  if old.status <> 'PENDING' and new.status <> old.status then
    raise exception 'a finished x402 payment cannot move' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger x402_payments_guard before update on public.x402_payments for each row execute function public.x402_payments_guard();
create trigger x402_payments_no_delete before delete on public.x402_payments for each row execute function public.forbid_change();
create trigger x402_payments_no_truncate before truncate on public.x402_payments for each statement execute function public.forbid_change();

alter table public.gateway_transfers enable row level security;
alter table public.x402_payments enable row level security;
revoke all on public.gateway_transfers, public.x402_payments from anon, authenticated;
grant select on public.gateway_transfers, public.x402_payments to authenticated;
grant all on public.gateway_transfers, public.x402_payments to service_role;
create policy gateway_transfers_select_own_company on public.gateway_transfers for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy x402_payments_select_own_company on public.x402_payments for select to authenticated
  using (company_id = (select public.current_company_id()));

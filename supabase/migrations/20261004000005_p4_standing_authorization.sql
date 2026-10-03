-- P4 slice 5: standing authorization (rule 25, ARCHITECTURE 14.8, S09). A payment approver signs once, within limits and an expiry;
-- the system may then authorize a CLEAN batch with it. The database enforces every limit when a batch is authorized under one.

create table public.standing_authorizations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  created_by uuid not null,
  max_batch_total bigint not null check (max_batch_total > 0),
  max_per_payment bigint not null check (max_per_payment > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  foreign key (company_id, revoked_by) references public.memberships (company_id, user_id),
  check (max_per_payment <= max_batch_total),
  check ((revoked_at is null) = (revoked_by is null))
);
create index standing_authorizations_company_idx on public.standing_authorizations (company_id, created_at);

create function public.standing_authorizations_guard() returns trigger
language plpgsql set search_path = '' as $$
declare roles_ text[];
begin
  if tg_op = 'DELETE' then raise exception 'standing authorizations are revoked, never deleted' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' then
    select m.roles into roles_ from public.memberships m where m.user_id = new.created_by and m.company_id = new.company_id and m.removed_at is null;
    if roles_ is null or not ('PAYMENT_APPROVER' = any (roles_)) then raise exception 'only a payment approver can sign a standing authorization' using errcode = 'P0001'; end if;
    if new.expires_at <= now() then raise exception 'a standing authorization must expire in the future' using errcode = 'P0001'; end if;
    return new;
  end if;
  -- the only change allowed: revoking once
  if (new.id, new.company_id, new.created_by, new.max_batch_total, new.max_per_payment, new.expires_at, new.created_at)
     is distinct from (old.id, old.company_id, old.created_by, old.max_batch_total, old.max_per_payment, old.expires_at, old.created_at)
     or (old.revoked_at is not null and (new.revoked_at, new.revoked_by) is distinct from (old.revoked_at, old.revoked_by)) then
    raise exception 'a standing authorization can only be revoked' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger standing_authorizations_guard before insert or update or delete on public.standing_authorizations for each row execute function public.standing_authorizations_guard();
create trigger standing_authorizations_no_truncate before truncate on public.standing_authorizations for each statement execute function public.forbid_change();
revoke all on function public.standing_authorizations_guard() from public, anon, authenticated;

alter table public.standing_authorizations enable row level security;
revoke all on public.standing_authorizations from anon, authenticated;
grant select on public.standing_authorizations to authenticated;
grant all on public.standing_authorizations to service_role;
create policy standing_authorizations_select_own_company on public.standing_authorizations for select to authenticated
  using (company_id = (select public.current_company_id()));

-- Batches say how they were authorized.
alter table public.payment_batches add column authorization_type text not null default 'HUMAN' check (authorization_type in ('HUMAN', 'STANDING'));
alter table public.payment_batches add column standing_authorization_id uuid;
alter table public.payment_batches add foreign key (company_id, standing_authorization_id) references public.standing_authorizations (company_id, id);
alter table public.payment_batches add constraint payment_batches_standing_link check ((authorization_type = 'STANDING') = (standing_authorization_id is not null));

-- The guard now also enforces, at the moment a batch is authorized under a standing authorization: it is the creator who authorizes,
-- the authorization is live and within its limits, and the plan is clean (no holds, no fired signals, not the fallback plan).
-- (Creator != payroll approver is the ordinary four-eyes check below it.)
create or replace function public.payment_batches_guard() returns trigger
language plpgsql set search_path = '' as $$
declare approver uuid; authorizer_roles text[]; sa record; total numeric; biggest numeric; ceiling_ bigint;
begin
  if tg_op = 'DELETE' then raise exception 'payment batches cannot be deleted' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.id, new.company_id, new.run_id, new.plan, new.plan_hash)
     is distinct from (old.id, old.company_id, old.run_id, old.plan, old.plan_hash) then
    raise exception 'the signed plan is immutable' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and ((old.authorizer_id is not null and new.authorizer_id is distinct from old.authorizer_id)
     or (old.guard_run_key is not null and new.guard_run_key is distinct from old.guard_run_key)
     or (old.status <> 'PROPOSED' and (new.authorization_type, new.standing_authorization_id) is distinct from (old.authorization_type, old.standing_authorization_id))) then
    raise exception 'the authorizer, the authorization and the guard run of a batch cannot change' using errcode = 'P0001';
  end if;
  if new.status in ('AUTHORIZED', 'OPEN', 'COMPLETED', 'CLOSED') then
    select approver_id into approver from public.payroll_approvals where run_id = new.run_id and company_id = new.company_id;
    select m.roles into authorizer_roles from public.memberships m where m.user_id = new.authorizer_id and m.company_id = new.company_id and m.removed_at is null;
    if approver is null then raise exception 'no payroll approval for this run' using errcode = 'P0001'; end if;
    if approver = new.authorizer_id then raise exception 'authorizer must differ from the payroll approver' using errcode = 'P0001'; end if;
    if authorizer_roles is null or not ('PAYMENT_APPROVER' = any (authorizer_roles)) then raise exception 'authorizer lacks the payment role' using errcode = 'P0001'; end if;
  end if;
  if new.status = 'AUTHORIZED' and (tg_op = 'INSERT' or old.status is distinct from 'AUTHORIZED') and new.authorization_type = 'STANDING' then
    select * into sa from public.standing_authorizations where id = new.standing_authorization_id and company_id = new.company_id;
    if sa.id is null then raise exception 'unknown standing authorization' using errcode = 'P0001'; end if;
    if sa.created_by is distinct from new.authorizer_id then raise exception 'a standing authorization is exercised by its creator' using errcode = 'P0001'; end if;
    if sa.revoked_at is not null then raise exception 'the standing authorization is revoked' using errcode = 'P0001'; end if;
    if sa.expires_at <= now() then raise exception 'the standing authorization has expired' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(new.plan -> 'heldIds', '[]'::jsonb)) > 0 then raise exception 'a batch with holds needs a human signature' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(new.plan -> 'signals', '[]'::jsonb)) > 0 then raise exception 'a batch with fired signals needs a human signature' using errcode = 'P0001'; end if;
    if coalesce(new.plan ->> 'source', 'FALLBACK') = 'FALLBACK' then raise exception 'a fallback plan needs a human signature' using errcode = 'P0001'; end if;
    select sum((o ->> 'amount')::numeric), max((o ->> 'amount')::numeric) into total, biggest from jsonb_array_elements(new.plan -> 'obligations') o;
    select per_payment_ceiling into ceiling_ from public.companies where id = new.company_id;
    if total > sa.max_batch_total then raise exception 'the batch is above the standing authorization total' using errcode = 'P0001'; end if;
    if biggest > sa.max_per_payment then raise exception 'a payment is above the standing authorization limit' using errcode = 'P0001'; end if;
    if biggest > ceiling_ then raise exception 'a payment is above the company ceiling' using errcode = 'P0001'; end if;
  end if;
  return coalesce(new, old);
end $$;

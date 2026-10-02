-- P3b slice 2 (S62, S64): invites. A company is created when the platform admin approves a waitlist entry (or an Owner
-- creates another one); the invite is the only way a person joins it. Only the SHA-256 of the token is stored.
-- Sandbox and demo companies can never have live payments (S64).

alter table public.companies add column is_sandbox boolean not null default false;
alter table public.companies add constraint companies_no_live_for_demo check (not ((is_demo or is_sandbox) and live_payments_enabled));

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  roles text[] not null check (
    cardinality(roles) > 0
    and roles <@ array['OWNER', 'HR_APPROVER', 'PAYROLL_APPROVER', 'PAYMENT_APPROVER', 'VIEWER']::text[]
  ),
  issuer text not null check (issuer in ('PLATFORM', 'OWNER')),
  issued_by uuid not null, -- auth user id of the platform admin or the Owner
  lead_id uuid,            -- the waitlist contact a platform invite came from
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  check (used_at is null or revoked_at is null)
);
-- One pending invite per person and company: a re-invite revokes the earlier one first.
create unique index invites_pending_key on public.invites (company_id, email) where used_at is null and revoked_at is null;
create index invites_lead_idx on public.invites (lead_id) where lead_id is not null;

create function public.invites_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'invites are never deleted' using errcode = 'P0001'; end if;
  if (new.id, new.company_id, new.email, new.roles, new.issuer, new.issued_by, new.lead_id, new.token_hash, new.expires_at, new.created_at)
     is distinct from (old.id, old.company_id, old.email, old.roles, old.issuer, old.issued_by, old.lead_id, old.token_hash, old.expires_at, old.created_at) then
    raise exception 'an invite cannot be edited' using errcode = 'P0001';
  end if;
  if (old.used_at is not null and (new.used_at, new.used_by) is distinct from (old.used_at, old.used_by))
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'a used or revoked invite is final' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger invites_guard before update or delete on public.invites for each row execute function public.invites_guard();
create trigger invites_no_truncate before truncate on public.invites for each statement execute function public.forbid_change();

alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;
grant all on public.invites to service_role;
create policy invites_select_own_company on public.invites for select to authenticated using (company_id = (select public.current_company_id()));

-- Acceptance in one transaction: the invite is locked, checked and burned, and the membership appears with it.
-- Every failure returns null so callers can answer all of them the same way (S62).
create function public.accept_invite(p_token_hash text, p_user uuid, p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare i public.invites%rowtype;
begin
  select * into i from public.invites where token_hash = p_token_hash for update;
  if not found or i.used_at is not null or i.revoked_at is not null or i.expires_at <= now() or i.email is distinct from lower(btrim(p_email)) then
    return null;
  end if;
  insert into public.memberships (user_id, company_id, roles, email) values (p_user, i.company_id, i.roles, i.email)
  on conflict (user_id, company_id) do update set roles = excluded.roles, email = excluded.email, removed_at = null
    where public.memberships.removed_at is not null;
  update public.invites set used_at = now(), used_by = p_user where id = i.id;
  return i.company_id;
end $$;

-- The account behind an email, if one exists (service role only; auth.users is not reachable through the API).
create function public.auth_user_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;

revoke all on function public.invites_guard() from public, anon, authenticated;
revoke all on function public.accept_invite(text, uuid, text) from public, anon, authenticated;
revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.accept_invite(text, uuid, text) to service_role;
grant execute on function public.auth_user_by_email(text) to service_role;

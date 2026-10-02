-- P3b slice 1 (S61, S63): memberships replace app_users. One row per (user, company) with several roles; a member is
-- removed softly (removed_at) so approvals, runs and audit rows that reference the user stay valid. Writes only via the
-- service role. The active company reaches RLS as a request header set by the server after it verified the signed cookie.

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  roles text[] not null check (
    cardinality(roles) > 0
    and roles <@ array['OWNER', 'HR_APPROVER', 'PAYROLL_APPROVER', 'PAYMENT_APPROVER', 'VIEWER']::text[]
  ),
  email text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (user_id, company_id),
  unique (company_id, user_id)
);
create index memberships_email_idx on public.memberships (lower(email)) where removed_at is null;
create index memberships_company_idx on public.memberships (company_id) where removed_at is null;

insert into public.memberships (user_id, company_id, roles, email)
select id, company_id, array[role], lower(email) from public.app_users;

-- Existing companies need an Owner: the payroll approver, else the first member.
update public.memberships m set roles = array_append(m.roles, 'OWNER')
where (m.company_id, m.user_id) in (
  select distinct on (company_id) company_id, user_id from public.memberships
  order by company_id, (roles @> array['PAYROLL_APPROVER']) desc, created_at, user_id
);

-- Every composite foreign key that pointed at app_users now points at memberships (same column meaning).
do $$
declare c record; def text;
begin
  for c in select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
           from pg_constraint where contype = 'f' and confrelid = 'public.app_users'::regclass
  loop
    def := regexp_replace(c.def, 'REFERENCES (public\.)?app_users\(company_id, id\)', 'REFERENCES public.memberships(company_id, user_id)');
    if def = c.def then raise exception 'unexpected foreign key %', c.conname; end if;
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format('alter table %s add constraint %I %s', c.tbl, c.conname, def);
  end loop;
end $$;

-- Four-eyes and role triggers read the member's roles (a member may hold several; removed members hold none).
create or replace function public.payroll_approvals_guard() returns trigger
language plpgsql set search_path = '' as $$
declare r record; c record; approver_roles text[];
begin
  select mode, status into r from public.payroll_runs where id = new.run_id and company_id = new.company_id;
  select calculation_hash, run_id into c from public.calculations where id = new.calculation_id and company_id = new.company_id;
  select m.roles into approver_roles from public.memberships m where m.user_id = new.approver_id and m.company_id = new.company_id and m.removed_at is null;
  if r.mode is distinct from 'LIVE_TESTNET' then raise exception 'only a LIVE_TESTNET run can be approved for payment' using errcode = 'P0001'; end if;
  if r.status is distinct from 'PENDING_APPROVAL' then raise exception 'run is not pending approval' using errcode = 'P0001'; end if;
  if c.run_id is distinct from new.run_id or c.calculation_hash is distinct from new.calculation_hash then
    raise exception 'approval must bind the run calculation hash' using errcode = 'P0001';
  end if;
  if approver_roles is null or not (approver_roles && array['PAYROLL_APPROVER', 'HR_APPROVER']) then raise exception 'approver lacks the payroll role' using errcode = 'P0001'; end if;
  return new;
end $$;

create or replace function public.payment_batches_guard() returns trigger
language plpgsql set search_path = '' as $$
declare approver uuid; authorizer_roles text[];
begin
  if tg_op = 'DELETE' then raise exception 'payment batches cannot be deleted' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.id, new.company_id, new.run_id, new.plan, new.plan_hash)
     is distinct from (old.id, old.company_id, old.run_id, old.plan, old.plan_hash) then
    raise exception 'the signed plan is immutable' using errcode = 'P0001';
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

-- Memberships are never deleted (soft removal keeps history valid), identity columns never change, and a company
-- always keeps at least one active Owner (S63).
create function public.memberships_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'memberships are removed softly, never deleted' using errcode = 'P0001'; end if;
  if (new.user_id, new.company_id) is distinct from (old.user_id, old.company_id) then raise exception 'a membership cannot move' using errcode = 'P0001'; end if;
  if old.removed_at is not null and new.removed_at is not null and new.roles is distinct from old.roles then raise exception 'a removed member keeps their last roles' using errcode = 'P0001'; end if;
  if 'OWNER' = any (old.roles) and old.removed_at is null and (new.removed_at is not null or not ('OWNER' = any (new.roles))) then
    if not exists (select 1 from public.memberships o where o.company_id = old.company_id and o.user_id <> old.user_id and o.removed_at is null and 'OWNER' = any (o.roles)) then
      raise exception 'a company needs at least one Owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_guard before update or delete on public.memberships for each row execute function public.memberships_guard();
create trigger memberships_no_truncate before truncate on public.memberships for each statement execute function public.forbid_change();

-- RLS: the active company is the x-kleeno-company header (set by the server from the verified cookie) when the caller is an
-- active member of it; without the header a user with exactly one company gets that company; otherwise nothing.
create or replace function public.current_company_id() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  hdr text := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-kleeno-company', '');
  ids uuid[];
begin
  select array_agg(m.company_id) into ids
  from public.memberships m join public.companies c on c.id = m.company_id
  where m.user_id = (select auth.uid()) and m.removed_at is null
    and (not c.mfa_required or (select auth.jwt() ->> 'aal') = 'aal2');
  if hdr is not null then
    if hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and hdr::uuid = any (coalesce(ids, '{}')) then return hdr::uuid; end if;
    return null;
  end if;
  if coalesce(array_length(ids, 1), 0) = 1 then return ids[1]; end if;
  return null;
end $$;

drop table public.app_users;

alter table public.memberships enable row level security;
revoke all on public.memberships from anon, authenticated;
grant select on public.memberships to authenticated;
grant all on public.memberships to service_role;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or company_id = (select public.current_company_id()));

revoke all on function public.memberships_guard() from public, anon, authenticated;

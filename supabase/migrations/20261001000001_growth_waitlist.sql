-- W: public waitlist + private lead list (docs/phases/W.md).
-- Platform data, not tenant data, so it lives in its own schema with no company_id (rule 32 covers `public`).
-- Only the server (service_role) can reach it: anon and authenticated get no USAGE and no grants (S51).
-- RLS is on with no policies as a second wall. Every write goes through src/server/db/growth.ts.

create schema if not exists growth;
revoke all on schema growth from public, anon, authenticated;
grant usage on schema growth to service_role;

create table growth.contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text check (role in ('PAYROLL', 'FINANCE', 'ACCOUNTING_AGENCY', 'FOUNDER_OPERATIONS', 'OTHER')),
  company_name text check (length(company_name) between 1 and 120),
  company_size text check (company_size in ('1_10', '11_50', '51_200', '201_1000', '1000_PLUS')),
  status text not null default 'NEW'
    check (status in ('NEW', 'QUALIFIED', 'CALL_SCHEDULED', 'CALL_DONE', 'PILOT_CANDIDATE', 'CLOSED', 'UNSUBSCRIBED')),
  source text check (length(source) <= 100),
  utm_source text check (length(utm_source) <= 100),
  utm_medium text check (length(utm_medium) <= 100),
  utm_campaign text check (length(utm_campaign) <= 100),
  consent_version text not null check (length(consent_version) <= 40),
  consented_at timestamptz not null,
  notes text check (length(notes) <= 5000),
  next_action_at date,
  is_test boolean not null default false, -- excluded from every metric (rule 42, S58)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_created_at on growth.contacts (created_at desc);

-- One survey per contact; a row exists only if at least one answer was given (skipping writes nothing).
create table growth.surveys (
  contact_id uuid primary key references growth.contacts (id) on delete cascade,
  pain_point text check (pain_point in ('RECONCILIATION', 'CONFIGURATION', 'CONTRACTOR_PAYMENTS', 'AUDITABILITY', 'MANUAL_ADMIN', 'OTHER')),
  budget_band text check (budget_band in ('FREE_ONLY', 'UNDER_100', '100_299', '300_499', '500_PLUS', 'UNSURE')),
  wants_call boolean,
  completed_at timestamptz not null default now(),
  check (pain_point is not null or budget_band is not null or wants_call is not null)
);

-- Continuation tokens (S54): only the SHA-256 is stored; 30 minutes; one use.
create table growth.survey_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  contact_id uuid not null references growth.contacts (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Status history: append-only (no update, no truncate). Rows go only when their contact is deleted on request.
create table growth.contact_events (
  id bigint generated always as identity primary key,
  contact_id uuid not null references growth.contacts (id) on delete cascade,
  actor uuid not null,
  from_status text not null,
  to_status text not null,
  created_at timestamptz not null default now()
);

-- Admin actions with no personal data (no email, no notes): fully append-only.
create table growth.admin_events (
  id bigint generated always as identity primary key,
  actor uuid not null,
  action text not null check (action in ('EXPORT', 'CONTACT_DELETED')),
  item_count int not null check (item_count >= 0),
  created_at timestamptz not null default now()
);

-- Fixed-window rate limits keyed by an HMAC of the IP (S55); rows older than a day are deleted on every hit.
create table growth.rate_limits (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (bucket, key_hash, window_start)
);

-- Platform admins: added only by scripts/add-platform-admin.ts. Company roles (app_users) grant nothing here.
create table growth.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create function growth.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'growth.% is append-only', tg_table_name;
end $$;
create trigger contact_events_no_update before update on growth.contact_events for each row execute function growth.forbid_change();
create trigger contact_events_no_truncate before truncate on growth.contact_events execute function growth.forbid_change();
create trigger admin_events_no_change before update or delete on growth.admin_events for each row execute function growth.forbid_change();
create trigger admin_events_no_truncate before truncate on growth.admin_events execute function growth.forbid_change();

-- Join: first write wins (S53). Returns false for an existing email and changes nothing.
-- With survey answers (combined form) the survey is saved at once; otherwise a continuation token is stored.
create function growth.join_waitlist(
  p_email text, p_consent_version text, p_source text, p_utm_source text, p_utm_medium text, p_utm_campaign text,
  p_role text, p_company_name text, p_company_size text, p_pain_point text, p_budget_band text, p_wants_call boolean,
  p_token_hash text
) returns boolean language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  insert into growth.contacts (email, role, company_name, company_size, source, utm_source, utm_medium, utm_campaign, consent_version, consented_at)
  values (p_email, p_role, p_company_name, p_company_size, p_source, p_utm_source, p_utm_medium, p_utm_campaign, p_consent_version, now())
  on conflict (email) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  if p_pain_point is not null or p_budget_band is not null or p_wants_call is not null then
    insert into growth.surveys (contact_id, pain_point, budget_band, wants_call) values (v_id, p_pain_point, p_budget_band, p_wants_call);
  elsif p_token_hash is not null then
    insert into growth.survey_tokens (token_hash, contact_id, expires_at) values (p_token_hash, v_id, now() + interval '30 minutes');
  end if;
  return true;
end $$;

-- Survey after sign-up: burns the token, fills only empty profile fields, saves the survey once. False = bad/used/expired token.
create function growth.complete_survey(
  p_token_hash text, p_role text, p_company_name text, p_company_size text, p_pain_point text, p_budget_band text, p_wants_call boolean
) returns boolean language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  update growth.survey_tokens set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning contact_id into v_id;
  if v_id is null then return false; end if;
  update growth.contacts
  set role = coalesce(role, p_role), company_name = coalesce(company_name, p_company_name),
      company_size = coalesce(company_size, p_company_size), updated_at = now()
  where id = v_id;
  if p_pain_point is not null or p_budget_band is not null or p_wants_call is not null then
    insert into growth.surveys (contact_id, pain_point, budget_band, wants_call) values (v_id, p_pain_point, p_budget_band, p_wants_call)
    on conflict (contact_id) do nothing;
  end if;
  return true;
end $$;

-- True = allowed. Window must be <= 1 day (older rows are swept here).
create function growth.hit_rate_limit(p_bucket text, p_key_hash text, p_window_seconds int, p_max int)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  delete from growth.rate_limits where window_start < now() - interval '1 day';
  insert into growth.rate_limits (bucket, key_hash, window_start) values (p_bucket, p_key_hash, v_window)
  on conflict (bucket, key_hash, window_start) do update set hits = growth.rate_limits.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

-- Status change + history row in one transaction; compare-and-set on the status the server read.
create function growth.set_status(p_contact uuid, p_from text, p_to text, p_actor uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  update growth.contacts set status = p_to, updated_at = now() where id = p_contact and status = p_from;
  if not found then return false; end if;
  insert into growth.contact_events (contact_id, actor, from_status, to_status) values (p_contact, p_actor, p_from, p_to);
  return true;
end $$;

-- Deletion on request (S57): hard delete (survey, tokens, history cascade) + an admin event without the email.
create function growth.delete_contact(p_contact uuid, p_actor uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  delete from growth.contacts where id = p_contact;
  if not found then return false; end if;
  insert into growth.admin_events (actor, action, item_count) values (p_actor, 'CONTACT_DELETED', 1);
  return true;
end $$;

alter table growth.contacts enable row level security;
alter table growth.surveys enable row level security;
alter table growth.survey_tokens enable row level security;
alter table growth.contact_events enable row level security;
alter table growth.admin_events enable row level security;
alter table growth.rate_limits enable row level security;
alter table growth.platform_admins enable row level security;

revoke all on all tables in schema growth from public, anon, authenticated;
revoke all on all sequences in schema growth from public, anon, authenticated;
revoke all on all functions in schema growth from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema growth to service_role;
grant usage, select on all sequences in schema growth to service_role;
grant execute on all functions in schema growth to service_role;

-- Lets the S51 test read the grant inventory through the API (service_role only).
create function public.growth_inventory()
returns table (table_name text, rls_enabled boolean, anon_any boolean, authenticated_any boolean, schema_usage_anon boolean, schema_usage_authenticated boolean)
language sql stable security definer set search_path = '' as $$
  select c.relname::text, c.relrowsecurity,
    has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger'),
    has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger'),
    has_schema_privilege('anon', 'growth', 'usage'),
    has_schema_privilege('authenticated', 'growth', 'usage')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'growth' and c.relkind = 'r'
$$;
revoke all on function public.growth_inventory() from public, anon, authenticated;
grant execute on function public.growth_inventory() to service_role;

-- Test support (S10, S11, S19): lets tests/db read the catalog through the service role instead of trusting a hand-written table list.
-- Read-only, returns metadata only (no data).
create function public.security_inventory()
returns table (
  table_name text,
  rls_enabled boolean,
  has_company_id boolean,
  company_id_not_null boolean,
  anon_any boolean,
  authenticated_select boolean,
  authenticated_write boolean,
  truncate_guarded boolean
)
language sql stable security definer set search_path = '' as $$
  select
    c.relname::text,
    c.relrowsecurity,
    a.attname is not null,
    coalesce(a.attnotnull, false),
    has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'),
    has_table_privilege('authenticated', c.oid, 'SELECT'),
    has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'),
    exists (select 1 from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal and (t.tgtype & 32) = 32)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname
$$;

revoke all on function public.security_inventory() from public, anon, authenticated;
grant execute on function public.security_inventory() to service_role;

-- The transition table is probed by tests/db/cas.test.ts against src/core/domain/machines.ts.
grant execute on function public.transition_allowed(text, text, text) to service_role;

-- P3 (S44): deletion on request. Immutability triggers block every delete by design, so removal needs one narrow, audited path:
-- this function, callable only by the service role from scripts/delete-company.ts. It disables the user triggers on the company's
-- tables inside ONE transaction (DDL is transactional: a failure re-enables everything), deletes in dependency order, removes the
-- wrapped data key (so any backup copy of the encrypted fields can no longer be read) and the company row. Returns row counts only.
create function public.delete_company(p_company uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t text;
  remaining text[];
  next_round text[];
  counts jsonb := '{}'::jsonb;
  n bigint;
  pass int := 0;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  select array_agg(c.relname::text order by c.relname) into remaining
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
  where ns.nspname = 'public' and c.relkind = 'r' and c.relname <> 'companies';

  foreach t in array remaining loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  alter table public.companies disable trigger user;

  while coalesce(array_length(remaining, 1), 0) > 0 loop
    pass := pass + 1;
    if pass > 12 then raise exception 'could not order the deletion' using errcode = 'P0001'; end if;
    next_round := '{}';
    foreach t in array remaining loop
      begin
        execute format('delete from public.%I where company_id = $1', t) using p_company;
        get diagnostics n = row_count;
        counts := counts || jsonb_build_object(t, coalesce((counts ->> t)::bigint, 0) + n);
      exception when foreign_key_violation then
        next_round := next_round || t; -- something still references these rows: try again after the others
      end;
    end loop;
    remaining := next_round;
  end loop;

  delete from public.companies where id = p_company;

  foreach t in array (select array_agg(c.relname::text) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
                      where ns.nspname = 'public' and c.relkind = 'r' and c.relname <> 'companies') loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  alter table public.companies enable trigger user;
  return counts;
end $$;

revoke all on function public.delete_company(uuid) from public, anon, authenticated;
grant execute on function public.delete_company(uuid) to service_role;

-- P2 review fixes: atomic calculation save, null-safe config check, truncate protection for more tables.

-- A calculation and all its lines are written in one transaction (a half-written immutable calculation could never be redone).
create function public.save_calculation(p_calc jsonb, p_lines jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.calculations (id, company_id, run_id, config_version, calculation_hash, snapshot_enc)
  values ((p_calc ->> 'id')::uuid, (p_calc ->> 'company_id')::uuid, (p_calc ->> 'run_id')::uuid, (p_calc ->> 'config_version')::int, p_calc ->> 'calculation_hash', p_calc ->> 'snapshot_enc');
  insert into public.calculation_lines (id, company_id, calculation_id, worker_id, net, gross_enc, deductions_enc, trace_enc)
  select (l ->> 'id')::uuid, (l ->> 'company_id')::uuid, (l ->> 'calculation_id')::uuid, (l ->> 'worker_id')::uuid, (l ->> 'net')::bigint, l ->> 'gross_enc', l ->> 'deductions_enc', l ->> 'trace_enc'
  from jsonb_array_elements(p_lines) l;
end $$;
revoke all on function public.save_calculation(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_calculation(jsonb, jsonb) to service_role;

-- A missing multiplier made the old CHECK evaluate to NULL (which passes). Missing now fails.
create or replace function public.config_params_ok(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and coalesce((p ->> 'overtimeMultiplier')::numeric between 1 and 3, false)
    and coalesce((p ->> 'aboveCapMultiplier')::numeric between 1 and 3, false)
    and coalesce((select bool_and((d ->> 'percent')::numeric between 0 and 100) from jsonb_array_elements(p -> 'deductions') d), true)
$$;

-- Truncate protection for the remaining tables (truncating company_keys would destroy every data key).
do $$
declare t text;
begin
  foreach t in array array['workers', 'exceptions', 'company_keys']
  loop
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

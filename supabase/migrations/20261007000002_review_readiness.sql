-- Commercial review settings are metadata; no payroll/payment authority.
create table public.payroll_review_settings (
  company_id uuid not null references public.companies(id),
  run_id uuid not null,
  revision integer not null check (revision > 0),
  cutoff_at timestamptz not null,
  time_zone text not null check (length(time_zone) between 1 and 64),
  required_types jsonb not null check (jsonb_typeof(required_types) = 'array' and jsonb_array_length(required_types) between 1 and 3),
  fresh_after timestamptz,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, run_id),
  foreign key (company_id, run_id) references public.payroll_runs(company_id, id),
  foreign key (company_id, updated_by) references public.memberships(company_id, user_id),
  check (fresh_after is null or fresh_after <= cutoff_at)
);
alter table public.payroll_review_settings enable row level security;
revoke all on public.payroll_review_settings from anon, authenticated;
grant select on public.payroll_review_settings to authenticated;
grant all on public.payroll_review_settings to service_role;
create policy payroll_review_settings_read on public.payroll_review_settings for select to authenticated
  using (company_id = (select public.current_company_id()));

create function public.payroll_review_settings_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'review settings cannot be deleted'; end if;
  perform 1 from public.companies where id = new.company_id for update;
  perform 1 from public.memberships where company_id = new.company_id and user_id = new.updated_by and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then raise exception 'review settings role required'; end if;
  if tg_op = 'UPDATE' and ((new.company_id,new.run_id) is distinct from (old.company_id,old.run_id) or new.revision <> old.revision + 1) then raise exception 'invalid review settings revision'; end if;
  if tg_op = 'INSERT' and new.revision <> 1 then raise exception 'invalid initial review settings revision'; end if;
  if exists(select 1 from public.payroll_review_events where company_id = new.company_id and run_id = new.run_id and action = 'SIGNOFF') then raise exception 'signed review settings frozen'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.time_zone)
    or exists(select 1 from jsonb_array_elements_text(new.required_types) t where t not in ('TIMESHEETS','LEAVE','ACTUAL_PAID'))
    or (select count(distinct t) from jsonb_array_elements_text(new.required_types) t) <> jsonb_array_length(new.required_types) then raise exception 'invalid review settings'; end if;
  return new;
end $$;
create trigger payroll_review_settings_guard before insert or update or delete on public.payroll_review_settings for each row execute function public.payroll_review_settings_guard();
create trigger payroll_review_settings_no_truncate before truncate on public.payroll_review_settings for each statement execute function public.forbid_change();
revoke all on function public.payroll_review_settings_guard() from public,anon,authenticated;

create function public.save_payroll_review_settings(p_company uuid, p_run uuid, p_actor uuid, p_expected_revision integer, p_cutoff timestamptz, p_timezone text, p_types jsonb, p_fresh_after timestamptz, p_correlation uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_revision integer;
begin
  perform 1 from public.companies where id = p_company for update;
  if not found then raise exception 'review company not found'; end if;
  perform 1 from public.payroll_runs where company_id = p_company and id = p_run for update;
  if not found then raise exception 'review run not found'; end if;
  perform 1 from public.memberships where company_id = p_company and user_id = p_actor and removed_at is null and roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[] for share;
  if not found then raise exception 'review settings role required'; end if;
  if exists(select 1 from public.payroll_review_events where company_id = p_company and run_id = p_run and action = 'SIGNOFF') then raise exception 'signed review settings frozen'; end if;
  if p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
    or p_cutoff is null or p_expected_revision is null or p_expected_revision < 0 or p_types is null or jsonb_typeof(p_types) <> 'array' then raise exception 'invalid review settings'; end if;
  if jsonb_array_length(p_types) not between 1 and 3
    or exists(select 1 from jsonb_array_elements_text(p_types) t where t not in ('TIMESHEETS','LEAVE','ACTUAL_PAID'))
    or (select count(distinct t) from jsonb_array_elements_text(p_types) t) <> jsonb_array_length(p_types)
    or (p_fresh_after is not null and p_fresh_after > p_cutoff) then raise exception 'invalid review requirements'; end if;
  select revision into v_revision from public.payroll_review_settings where company_id = p_company and run_id = p_run;
  if coalesce(v_revision, 0) <> p_expected_revision then raise exception 'stale review settings'; end if;
  v_revision := coalesce(v_revision, 0) + 1;
  insert into public.payroll_review_settings(company_id, run_id, revision, cutoff_at, time_zone, required_types, fresh_after, updated_by)
    values(p_company,p_run,v_revision,p_cutoff,p_timezone,p_types,p_fresh_after,p_actor)
    on conflict(company_id,run_id) do update set revision=excluded.revision,cutoff_at=excluded.cutoff_at,time_zone=excluded.time_zone,required_types=excluded.required_types,fresh_after=excluded.fresh_after,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'review.settings','payroll_run',p_run,p_actor::text,'user',p_correlation::text,jsonb_build_object('revision',v_revision));
  return v_revision;
end $$;
revoke all on function public.save_payroll_review_settings(uuid,uuid,uuid,integer,timestamptz,text,jsonb,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.save_payroll_review_settings(uuid,uuid,uuid,integer,timestamptz,text,jsonb,timestamptz,uuid) to service_role;

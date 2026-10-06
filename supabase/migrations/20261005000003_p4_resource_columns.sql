-- Policy-backed presentation resources. No authority over payroll, approvals or payments.
create table public.resource_columns (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  column_key text not null check (column_key ~ '^r_[0-9a-f]{24}$'),
  definition_enc text not null,
  policy_config_version int,
  created_by uuid not null,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id), unique (company_id, column_key),
  foreign key (company_id, policy_config_version) references public.payroll_configurations(company_id, version),
  foreign key (company_id, created_by) references public.memberships(company_id, user_id)
);
create table public.resource_inputs (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  column_id uuid not null, worker_id uuid not null,
  version int not null check (version > 0),
  input_enc text not null,
  created_by uuid not null, correlation_id text not null,
  created_at timestamptz not null default now(),
  unique (company_id, id), unique (company_id, column_id, worker_id, version),
  foreign key (company_id, column_id) references public.resource_columns(company_id, id),
  foreign key (company_id, worker_id) references public.workers(company_id, id),
  foreign key (company_id, created_by) references public.memberships(company_id, user_id)
);
create table public.table_layouts (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  owner_id uuid not null,
  table_id text not null check (table_id in ('workers','timesheets','leave','exceptions','lines','runs')),
  view_enc text not null, version int not null check (version > 0),
  correlation_id text not null,
  updated_at timestamptz not null default now(),
  unique (company_id, owner_id, table_id),
  foreign key (company_id, owner_id) references public.memberships(company_id, user_id)
);
create table public.cell_comments (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  table_id text not null check (table_id in ('workers','timesheets','leave','exceptions','lines','runs')),
  run_id uuid, row_id uuid not null, column_id text not null check (length(column_id) between 1 and 30),
  text_enc text not null, author_id uuid not null, correlation_id text not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, run_id) references public.payroll_runs(company_id,id),
  foreign key (company_id, author_id) references public.memberships(company_id,user_id)
);
create index resource_inputs_current on public.resource_inputs(company_id,column_id,worker_id,version desc);
create index cell_comments_thread on public.cell_comments(company_id,table_id,row_id,column_id,created_at);

create function public.resource_hr_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m where m.company_id = new.company_id and m.user_id = new.created_by and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER']) then
    raise exception 'resource review requires HR authority' using errcode = 'P0001';
  end if;
  if tg_table_name = 'resource_columns' then
  perform 1 from public.companies c where c.id = new.company_id for update;
  if (select count(*) from public.resource_columns c where c.company_id = new.company_id) >= 24 then raise exception 'maximum 24 resource columns' using errcode = 'P0001'; end if;
  if new.policy_config_version is not null and not exists (
    select 1 from public.payroll_configurations c where c.company_id = new.company_id and c.version = new.policy_config_version and c.status in ('APPROVED','ACTIVE','SUPERSEDED')
  ) then raise exception 'approved policy version required' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
create trigger resource_columns_hr before insert on public.resource_columns for each row execute function public.resource_hr_guard();
create trigger resource_inputs_hr before insert on public.resource_inputs for each row execute function public.resource_hr_guard();

create function public.presentation_audit() returns trigger language plpgsql set search_path = '' as $$
declare actor_id uuid;
begin
  actor_id := (to_jsonb(new) ->> case when tg_table_name = 'table_layouts' then 'owner_id' when tg_table_name = 'cell_comments' then 'author_id' else 'created_by' end)::uuid;
  if not exists (select 1 from public.memberships m where m.company_id = new.company_id and m.user_id = actor_id and m.removed_at is null) then
    raise exception 'active membership required' using errcode = 'P0001';
  end if;
  if tg_table_name = 'table_layouts' and tg_op = 'UPDATE' then
  if ((new.id,new.company_id,new.owner_id,new.table_id) is distinct from (old.id,old.company_id,old.owner_id,old.table_id) or new.version <> old.version + 1) then
    raise exception 'layout identity and version are guarded' using errcode = 'P0001';
  end if;
  end if;
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
  values(new.company_id, tg_table_name || '.reviewed', tg_table_name, new.id, actor_id::text, 'user', new.correlation_id, '{}'::jsonb);
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['resource_columns','resource_inputs','table_layouts','cell_comments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.presentation_audit()',t || '_audit',t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public.forbid_change()',t || '_no_truncate',t);
    if t <> 'table_layouts' then execute format('create trigger %I before update or delete on public.%I for each row execute function public.forbid_change()',t || '_immutable',t); end if;
  end loop;
end $$;
create policy resource_columns_read on public.resource_columns for select to authenticated using (company_id = (select public.current_company_id()) and exists (select 1 from public.memberships m where m.company_id = resource_columns.company_id and m.user_id = (select auth.uid()) and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER']));
create policy resource_inputs_read on public.resource_inputs for select to authenticated using (company_id = (select public.current_company_id()) and exists (select 1 from public.memberships m where m.company_id = resource_inputs.company_id and m.user_id = (select auth.uid()) and m.removed_at is null and m.roles && array['HR_APPROVER','PAYROLL_APPROVER']));
create policy layouts_personal on public.table_layouts for select to authenticated using (company_id = (select public.current_company_id()) and owner_id = (select auth.uid()));
create policy comments_company on public.cell_comments for select to authenticated using (company_id = (select public.current_company_id()));

create function public.latest_resource_inputs(p_company uuid, p_columns uuid[], p_workers uuid[])
returns table(id uuid,column_id uuid,worker_id uuid,version int,created_at timestamptz,input_enc text)
language sql stable security invoker set search_path = '' as $$
  select distinct on (r.column_id,r.worker_id) r.id,r.column_id,r.worker_id,r.version,r.created_at,r.input_enc
  from public.resource_inputs r
  where r.company_id = p_company and r.column_id = any(p_columns) and r.worker_id = any(p_workers)
    and cardinality(p_columns) <= 24 and cardinality(p_workers) <= 500
  order by r.column_id,r.worker_id,r.version desc
$$;
revoke all on function public.latest_resource_inputs(uuid,uuid[],uuid[]) from public,anon;
grant execute on function public.latest_resource_inputs(uuid,uuid[],uuid[]) to authenticated,service_role;

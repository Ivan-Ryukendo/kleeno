-- Presentation only: encrypted immutable definitions never grant payroll authority.
create table public.named_table_views (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  table_id text not null check(table_id in ('workers','timesheets','leave','exceptions','lines','runs')),
  scope text not null check(scope in ('PERSONAL','TEAM')),
  owner_id uuid not null,
  revision integer not null check(revision>0),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,owner_id) references public.memberships(company_id,user_id)
);
create table public.named_table_view_versions (
  id uuid primary key,
  company_id uuid not null,
  view_id uuid not null,
  revision integer not null check(revision>0),
  action text not null check(action in ('CREATE','UPDATE','ARCHIVE')),
  actor_id uuid not null,
  payload_enc text,
  idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(company_id,view_id,revision), unique(company_id,idempotency_key),
  foreign key(company_id,view_id) references public.named_table_views(company_id,id),
  foreign key(company_id,actor_id) references public.memberships(company_id,user_id),
  check((action='ARCHIVE' and payload_enc is null) or (action<>'ARCHIVE' and length(payload_enc)>0 and payload_enc is not null)),
  check((revision=1 and action='CREATE') or (revision>1 and action<>'CREATE'))
);
create index named_views_recent on public.named_table_views(company_id,table_id,updated_at desc,id desc);
alter table public.named_table_views enable row level security;
alter table public.named_table_view_versions enable row level security;
revoke all on public.named_table_views,public.named_table_view_versions from public,anon,authenticated,service_role;
grant select on public.named_table_views,public.named_table_view_versions to authenticated,service_role;
create policy named_views_select on public.named_table_views for select to authenticated using (
  company_id=(select public.current_company_id()) and (scope='TEAM' or owner_id=(select auth.uid()))
);
create policy named_versions_select on public.named_table_view_versions for select to authenticated using (
  company_id=(select public.current_company_id()) and exists(select 1 from public.named_table_views h
    where h.company_id=named_table_view_versions.company_id and h.id=named_table_view_versions.view_id
      and (h.scope='TEAM' or h.owner_id=(select auth.uid())))
);
create trigger named_versions_immutable before update or delete on public.named_table_view_versions for each row execute function public.forbid_change();
create trigger named_versions_no_truncate before truncate on public.named_table_view_versions for each statement execute function public.forbid_change();
create trigger named_views_no_delete before delete on public.named_table_views for each row execute function public.forbid_change();
create trigger named_views_no_truncate before truncate on public.named_table_views for each statement execute function public.forbid_change();
create function public.named_view_head_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.company_id,new.table_id,new.scope,new.owner_id,new.created_at) is distinct from
    (old.id,old.company_id,old.table_id,old.scope,old.owner_id,old.created_at)
    or old.archived or new.revision<>old.revision+1 then
    raise exception 'named view identity/history is immutable' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger named_view_head_guard before update on public.named_table_views for each row execute function public.named_view_head_guard();

create function public.append_named_table_view(p_company uuid,p_table text,p_actor uuid,p_correlation text,
  p_view uuid,p_version uuid,p_scope text,p_action text,p_expected_revision integer,
  p_idempotency_key uuid,p_command_hash text,p_payload_enc text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.named_table_views%rowtype; retry public.named_table_view_versions%rowtype; member_roles text[]; rev integer;
begin
  -- Company serializes command-key races; membership lock prevents revocation during commit.
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  select roles into member_roles from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null for share;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  if p_scope is null or p_scope not in ('PERSONAL','TEAM') or p_action is null or p_action not in ('CREATE','UPDATE','ARCHIVE')
    or p_table is null or p_table not in ('workers','timesheets','leave','exceptions','lines','runs')
    or p_command_hash is null or p_command_hash !~ '^[a-f0-9]{64}$' or p_view is null or p_version is null
    or p_idempotency_key is null or p_expected_revision is null or p_expected_revision<0
    or p_expected_revision>=2147483647 or p_correlation is null or length(p_correlation)=0
    or (p_action='ARCHIVE' and p_payload_enc is not null)
    or (p_action<>'ARCHIVE' and (p_payload_enc is null or length(p_payload_enc)=0)) then
    return jsonb_build_object('code','CONFLICT');
  end if;
  if p_scope='TEAM' and not (member_roles && array['HR_APPROVER','PAYROLL_APPROVER']::text[]) then return jsonb_build_object('code','FORBIDDEN'); end if;
  select * into retry from public.named_table_view_versions where company_id=p_company and idempotency_key=p_idempotency_key;
  if found then
    select * into h from public.named_table_views where company_id=p_company and id=retry.view_id;
    if retry.actor_id<>p_actor or retry.command_hash<>p_command_hash or retry.action<>p_action or retry.revision<>p_expected_revision+1
      or h.table_id<>p_table or h.scope<>p_scope or (h.scope='PERSONAL' and h.owner_id<>p_actor)
      or (p_action<>'CREATE' and retry.view_id<>p_view) then return jsonb_build_object('code','CONFLICT'); end if;
    return jsonb_build_object('code','OK','id',retry.view_id,'revision',retry.revision);
  end if;
  if p_action='CREATE' then
    if p_expected_revision<>0 or exists(select 1 from public.named_table_views where id=p_view) then return jsonb_build_object('code','CONFLICT'); end if;
    rev:=1;
    insert into public.named_table_views(id,company_id,table_id,scope,owner_id,revision) values(p_view,p_company,p_table,p_scope,p_actor,rev);
  else
    select * into h from public.named_table_views where company_id=p_company and id=p_view for update;
    if not found or h.table_id<>p_table or (h.scope='PERSONAL' and h.owner_id<>p_actor) then return jsonb_build_object('code','NOT_FOUND'); end if;
    if h.scope<>p_scope or h.archived or h.revision<>p_expected_revision then return jsonb_build_object('code','CONFLICT'); end if;
    rev:=h.revision+1;
    update public.named_table_views set revision=rev,archived=(p_action='ARCHIVE'),updated_at=now() where company_id=p_company and id=p_view;
  end if;
  insert into public.named_table_view_versions(id,company_id,view_id,revision,action,actor_id,payload_enc,idempotency_key,command_hash)
    values(p_version,p_company,p_view,rev,p_action,p_actor,p_payload_enc,p_idempotency_key,p_command_hash);
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'named_view.'||lower(p_action),'named_view',p_view,p_actor::text,'user',p_correlation,
      jsonb_build_object('table',p_table,'scope',p_scope,'revision',rev));
  return jsonb_build_object('code','OK','id',p_view,'revision',rev);
end $$;
revoke all on function public.named_view_head_guard() from public,anon,authenticated;
revoke all on function public.append_named_table_view(uuid,text,uuid,text,uuid,uuid,text,text,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.append_named_table_view(uuid,text,uuid,text,uuid,uuid,text,text,integer,uuid,text,text) to service_role;

-- Company-encrypted submitted support, never payroll/payment authority.
-- Recovery: disable support routes; retain immutable history. Existing delete_company discovers these company tables.
create table public.support_requests (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  requester_id uuid not null,
  category text not null check(category in ('ACCOUNT','IMPORT','REVIEW','OTHER')),
  severity text not null check(severity in ('NORMAL','URGENT')),
  status text not null check(status in ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED')),
  assignee_id uuid references auth.users(id),
  revision integer not null check(revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,requester_id) references public.memberships(company_id,user_id)
);
create table public.support_events (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check(action in ('CREATE','REPLY','NOTE','TRIAGE','CLOSE')),
  visibility text not null check(visibility in ('CUSTOMER','INTERNAL')),
  revision integer not null check(revision>0),
  idempotency_key uuid not null,
  command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
  payload_enc text,
  status text not null check(status in ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED')),
  severity text not null check(severity in ('NORMAL','URGENT')),
  assignee_id uuid references auth.users(id),
  correlation_id text not null,
  created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,idempotency_key), unique(company_id,request_id,revision),
  foreign key(company_id,request_id) references public.support_requests(company_id,id),
  check((action='NOTE' and visibility='INTERNAL') or (action<>'NOTE' and visibility='CUSTOMER')),
  check((action in ('CREATE','REPLY','NOTE') and payload_enc is not null and length(payload_enc)>0) or (action in ('TRIAGE','CLOSE') and payload_enc is null))
);
create index support_request_queue on public.support_requests(updated_at desc,id);
create index support_request_self on public.support_requests(company_id,requester_id,updated_at desc);
alter table public.support_requests enable row level security;
alter table public.support_events enable row level security;
revoke all on public.support_requests,public.support_events from anon,authenticated;
grant select on public.support_requests,public.support_events to authenticated;
grant all on public.support_requests,public.support_events to service_role;
create policy support_requests_read on public.support_requests for select to authenticated
  using(company_id=(select public.current_company_id()) and requester_id=(select auth.uid()));
create policy support_events_read on public.support_events for select to authenticated
  using(visibility='CUSTOMER' and company_id=(select public.current_company_id()) and exists(select 1 from public.support_requests r where r.company_id=support_events.company_id and r.id=support_events.request_id and r.requester_id=(select auth.uid())));
create trigger support_events_immutable before update or delete on public.support_events for each row execute function public.forbid_change();
create trigger support_events_no_truncate before truncate on public.support_events for each statement execute function public.forbid_change();
create trigger support_requests_no_delete before delete on public.support_requests for each row execute function public.forbid_change();
create trigger support_requests_no_truncate before truncate on public.support_requests for each statement execute function public.forbid_change();

create function public.support_request_revision_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.company_id,new.requester_id,new.category,new.created_at) is distinct from (old.id,old.company_id,old.requester_id,old.category,old.created_at) or new.revision<>old.revision+1 then
    raise exception 'support request identity or revision cannot change';
  end if;
  return new;
end $$;
create trigger support_request_revision before update on public.support_requests for each row execute function public.support_request_revision_guard();
revoke all on function public.support_request_revision_guard() from public,anon,authenticated;

create function public.append_support_event(p_company uuid,p_request uuid,p_actor uuid,p_admin boolean,p_correlation text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  r public.support_requests%rowtype;
  prior public.support_events%rowtype;
  act text:=p_command->>'action';
  event_id uuid:=(p_command->>'id')::uuid;
  next_status text;
  next_severity text;
  next_assignee uuid;
  current_revision integer;
begin
  -- ponytail: serialize support changes per company; move to per-request/advisory creation locks if queue throughput needs it.
  perform 1 from public.companies where id=p_company for update;
  if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  if p_admin then
    perform 1 from growth.platform_admins where user_id=p_actor for share;
  else
    perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null for share;
  end if;
  if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
  if p_admin is null or act is null or act not in ('CREATE','REPLY','NOTE','TRIAGE','CLOSE') or (p_admin and act in ('CREATE','CLOSE')) or (not p_admin and act in ('NOTE','TRIAGE')) or p_correlation is null then return jsonb_build_object('code','CONFLICT'); end if;
  if act<>'CREATE' then
    select * into r from public.support_requests where company_id=p_company and id=p_request for update;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    if not p_admin and r.requester_id<>p_actor then return jsonb_build_object('code','FORBIDDEN'); end if;
  end if;
  select * into prior from public.support_events where company_id=p_company and idempotency_key=(p_command->>'idempotency_key')::uuid;
  if found then
    if prior.actor_id<>p_actor or prior.action<>act or prior.command_hash is distinct from (p_command->>'command_hash') or (act<>'CREATE' and prior.request_id<>p_request) then return jsonb_build_object('code','CONFLICT'); end if;
    return jsonb_build_object('code','OK','id',prior.request_id,'revision',prior.revision);
  end if;
  if (p_command->>'command_hash') is null or (p_command->>'command_hash') !~ '^[a-f0-9]{64}$' or ((act in ('CREATE','REPLY','NOTE')) and coalesce(length(p_command->>'payload_enc'),0)=0) or ((act in ('TRIAGE','CLOSE')) and p_command->>'payload_enc' is not null) then return jsonb_build_object('code','CONFLICT'); end if;
  if act='CREATE' then
    if (p_command->>'expected_revision')::integer is distinct from 0 or p_command->>'category' is null or p_command->>'category' not in ('ACCOUNT','IMPORT','REVIEW','OTHER') or p_command->>'severity' is null or p_command->>'severity' not in ('NORMAL','URGENT') then return jsonb_build_object('code','CONFLICT'); end if;
    current_revision:=0; next_status:='OPEN'; next_severity:=p_command->>'severity'; next_assignee:=null;
    insert into public.support_requests(id,company_id,requester_id,category,severity,status,revision) values(p_request,p_company,p_actor,p_command->>'category',next_severity,next_status,1);
  else
    current_revision:=r.revision;
    if (p_command->>'expected_revision')::integer is distinct from current_revision then return jsonb_build_object('code','CONFLICT'); end if;
    next_status:=r.status; next_severity:=r.severity; next_assignee:=r.assignee_id;
    if act='REPLY' then next_status:=case when p_admin then 'WAITING_CUSTOMER' else 'OPEN' end;
    elsif act='CLOSE' then next_status:='RESOLVED';
    elsif act='TRIAGE' then
      next_status:=p_command->>'status'; next_severity:=p_command->>'severity'; next_assignee:=(p_command->>'assignee_id')::uuid;
      if next_status is null or next_status not in ('OPEN','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED') or next_severity is null or next_severity not in ('NORMAL','URGENT') then return jsonb_build_object('code','CONFLICT'); end if;
      if next_assignee is not null then
        perform 1 from growth.platform_admins where user_id=next_assignee for share;
        if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
      end if;
    end if;
    update public.support_requests set status=next_status,severity=next_severity,assignee_id=next_assignee,revision=current_revision+1,updated_at=now() where company_id=p_company and id=p_request;
  end if;
  insert into public.support_events(id,company_id,request_id,actor_id,action,visibility,revision,idempotency_key,command_hash,payload_enc,status,severity,assignee_id,correlation_id)
    values(event_id,p_company,p_request,p_actor,act,case when act='NOTE' then 'INTERNAL' else 'CUSTOMER' end,current_revision+1,(p_command->>'idempotency_key')::uuid,p_command->>'command_hash',p_command->>'payload_enc',next_status,next_severity,next_assignee,p_correlation);
  insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs)
    values(p_company,'support.'||lower(act),'support_request',p_request,p_actor::text,'user',p_correlation,jsonb_build_object('version',current_revision+1,'action',act));
  return jsonb_build_object('code','OK','id',p_request,'revision',current_revision+1);
end $$;
revoke all on function public.append_support_event(uuid,uuid,uuid,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.append_support_event(uuid,uuid,uuid,boolean,text,jsonb) to service_role;

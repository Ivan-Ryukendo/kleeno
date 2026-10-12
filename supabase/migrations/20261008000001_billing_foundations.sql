-- Authored only. Subscription metadata never grants financial authority.
create table growth.billing_tiers (
 id uuid primary key, revision integer not null check(revision>0), name text not null check(length(name) between 1 and 80),
 base_cents integer not null check(base_cents between 0 and 100000000), worker_cents integer not null check(worker_cents between 0 and 100000000), archived boolean not null default false
);
create table growth.billing_catalog_events (
 id uuid primary key, tier_id uuid not null references growth.billing_tiers(id), revision integer not null,
 actor_id uuid not null references auth.users(id), action text not null check(action in ('create','revise','archive')),
 idempotency_key uuid not null unique, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
 correlation_id text not null, created_at timestamptz not null default now(), unique(tier_id,revision),
 name text not null, base_cents integer not null, worker_cents integer not null, archived boolean not null
);
-- Catalog audit references deliberately omit price/reason. Company-specific terms are encrypted.
create table public.billing_company_events (
 id uuid primary key, company_id uuid not null references public.companies(id), revision integer not null check(revision>0),
 actor_id uuid not null references auth.users(id), action text not null check(action in ('assign','activate_demo')),
 tier_id uuid references growth.billing_tiers(id), tier_revision integer, payload_enc text not null,
 usage_enabled boolean not null default false, idempotency_key uuid not null, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'),
 correlation_id text not null, created_at timestamptz not null default now(), unique(company_id,id), unique(company_id,revision), unique(company_id,idempotency_key)
);
create unique index billing_demo_once on public.billing_company_events(company_id) where action='activate_demo';
create table public.billing_worker_usage (
 company_id uuid not null references public.companies(id), month date not null check(extract(day from month)=1),
 worker_id uuid not null, review_event_id uuid not null, assignment_id uuid not null, created_at timestamptz not null,
 primary key(company_id,month,worker_id), foreign key(company_id,worker_id) references public.workers(company_id,id),
 foreign key(company_id,review_event_id) references public.payroll_review_events(company_id,id),
 foreign key(company_id,assignment_id) references public.billing_company_events(company_id,id)
);
alter table growth.billing_tiers enable row level security;
alter table growth.billing_catalog_events enable row level security;
revoke all on growth.billing_tiers,growth.billing_catalog_events from public,anon,authenticated;
grant select on growth.billing_tiers,growth.billing_catalog_events to service_role;
alter table public.billing_company_events enable row level security;
alter table public.billing_worker_usage enable row level security;
revoke all on public.billing_company_events,public.billing_worker_usage from public,anon,authenticated;
grant select on public.billing_company_events,public.billing_worker_usage to authenticated;
grant select on public.billing_company_events,public.billing_worker_usage to service_role;
create policy billing_terms_owner on public.billing_company_events for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_company_events.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create policy billing_usage_owner on public.billing_worker_usage for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_worker_usage.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create trigger billing_catalog_immutable before update or delete on growth.billing_catalog_events for each row execute function public.forbid_change();
create trigger billing_catalog_no_truncate before truncate on growth.billing_catalog_events for each statement execute function public.forbid_change();
create trigger billing_terms_immutable before update or delete on public.billing_company_events for each row execute function public.forbid_change();
create trigger billing_terms_no_truncate before truncate on public.billing_company_events for each statement execute function public.forbid_change();
create trigger billing_usage_immutable before update or delete on public.billing_worker_usage for each row execute function public.forbid_change();
create trigger billing_usage_no_truncate before truncate on public.billing_worker_usage for each statement execute function public.forbid_change();

create function public.billing_catalog_command(p_actor uuid,p_correlation text,p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t growth.billing_tiers%rowtype; prior growth.billing_catalog_events%rowtype; act text:=p_command->>'action'; tier uuid:=(p_command->>'id')::uuid; rev integer;
begin
 -- ponytail: serialize small catalog; use per-tier locks if catalog write throughput matters.
 perform pg_catalog.pg_advisory_xact_lock(81008001);
 perform 1 from growth.platform_admins where user_id=p_actor for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 select * into prior from growth.billing_catalog_events where idempotency_key=(p_command->>'idempotency_key')::uuid;
 if found then
  if prior.actor_id<>p_actor or prior.command_hash is distinct from p_command->>'command_hash' or prior.tier_id<>tier then return jsonb_build_object('code','CONFLICT'); end if;
  return jsonb_build_object('code','OK','revision',prior.revision);
 end if;
 select * into t from growth.billing_tiers where id=tier for update;
 if act='create' then
  if found or (p_command->>'expectedRevision')::integer is distinct from 0 then return jsonb_build_object('code','CONFLICT'); end if;
  insert into growth.billing_tiers(id,revision,name,base_cents,worker_cents) values(tier,1,p_command->'price'->>'name',(p_command->'price'->>'baseCents')::integer,(p_command->'price'->>'workerCents')::integer);
 elsif act in ('revise','archive') then
  if not found or t.archived or t.revision is distinct from (p_command->>'expectedRevision')::integer then return jsonb_build_object('code','CONFLICT'); end if;
  update growth.billing_tiers set revision=revision+1, archived=act='archive', name=case when act='revise' then p_command->'price'->>'name' else name end,
   base_cents=case when act='revise' then (p_command->'price'->>'baseCents')::integer else base_cents end, worker_cents=case when act='revise' then (p_command->'price'->>'workerCents')::integer else worker_cents end where id=tier;
 else return jsonb_build_object('code','CONFLICT'); end if;
 select * into t from growth.billing_tiers where id=tier;
 insert into growth.billing_catalog_events(id,tier_id,revision,actor_id,action,idempotency_key,command_hash,correlation_id,name,base_cents,worker_cents,archived)
 values(gen_random_uuid(),tier,t.revision,p_actor,act,(p_command->>'idempotency_key')::uuid,p_command->>'command_hash',p_correlation,t.name,t.base_cents,t.worker_cents,t.archived);
 return jsonb_build_object('code','OK','revision',t.revision);
end $$;

create function public.billing_company_command(p_company uuid,p_actor uuid,p_correlation text,p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_company_events%rowtype; rev integer; act text:=p_command->>'action'; c record; t record; tier uuid:=(p_command->>'tierId')::uuid;
begin
 select * into c from public.companies where id=p_company for update;
 if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
 perform 1 from growth.platform_admins where user_id=p_actor for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 select * into prior from public.billing_company_events where company_id=p_company and idempotency_key=(p_command->>'idempotencyKey')::uuid;
 if found then
  if prior.actor_id<>p_actor or prior.command_hash is distinct from p_command->>'command_hash' then return jsonb_build_object('code','CONFLICT'); end if;
  return jsonb_build_object('code','OK','revision',prior.revision);
 end if;
 select coalesce(max(revision),0) into rev from public.billing_company_events where company_id=p_company;
 if rev is distinct from (p_command->>'expectedRevision')::integer then return jsonb_build_object('code','CONFLICT'); end if;
 if act='activate_demo' then
  if not c.is_demo or c.live_payments_enabled or exists(select 1 from public.billing_company_events where company_id=p_company and action='activate_demo') then return jsonb_build_object('code','CONFLICT'); end if;
 elsif act='assign' then
  if (p_command->>'usageEnabled')::boolean and (c.is_demo or c.is_sandbox) then return jsonb_build_object('code','CONFLICT'); end if;
  if tier is not null then
   select * into t from growth.billing_tiers where id=tier for share;
   if not found or t.archived or t.revision is distinct from (p_command->>'tierRevision')::integer
    or t.base_cents is distinct from (p_command->'price'->>'baseCents')::integer or t.worker_cents is distinct from (p_command->'price'->>'workerCents')::integer or t.name is distinct from p_command->'price'->>'name' then return jsonb_build_object('code','CONFLICT'); end if;
  elsif p_command->>'tierRevision' is not null then return jsonb_build_object('code','CONFLICT'); end if;
 else return jsonb_build_object('code','CONFLICT'); end if;
 insert into public.billing_company_events(id,company_id,revision,actor_id,action,tier_id,tier_revision,payload_enc,usage_enabled,idempotency_key,command_hash,correlation_id)
 values((p_command->>'event_id')::uuid,p_company,rev+1,p_actor,act,tier,(p_command->>'tierRevision')::integer,p_command->>'payload_enc',coalesce((p_command->>'usageEnabled')::boolean,false),(p_command->>'idempotencyKey')::uuid,p_command->>'command_hash',p_correlation);
 insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs) values(p_company,'billing.'||act,'billing',(p_command->>'event_id')::uuid,p_actor::text,'user',p_correlation,jsonb_build_object('version',rev+1,'action',act));
 return jsonb_build_object('code','OK','revision',rev+1);
end $$;
revoke all on function public.billing_catalog_command(uuid,text,jsonb),public.billing_company_command(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_catalog_command(uuid,text,jsonb),public.billing_company_command(uuid,uuid,text,jsonb) to service_role;

create function public.record_billing_review_usage() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.action='SIGNOFF' and exists(select 1 from public.companies c where c.id=new.company_id and not c.is_demo and not c.is_sandbox)
 and coalesce((select e.usage_enabled from public.billing_company_events e where e.company_id=new.company_id and e.action='assign' and e.created_at<=new.created_at order by e.revision desc limit 1),false) then
   insert into public.billing_worker_usage(company_id,month,worker_id,review_event_id,assignment_id,created_at)
   select new.company_id,date_trunc('month',new.created_at at time zone 'UTC')::date,l.worker_id,new.id,(select e.id from public.billing_company_events e where e.company_id=new.company_id and e.action='assign' and e.created_at<=new.created_at order by e.revision desc limit 1),new.created_at from public.calculation_lines l where l.company_id=new.company_id and l.calculation_id=new.calculation_id
   on conflict(company_id,month,worker_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function public.record_billing_review_usage() from public,anon,authenticated;
create trigger billing_signoff_usage after insert on public.payroll_review_events for each row execute function public.record_billing_review_usage();
-- No historical company classification is guessed: only explicitly enabled assignments effective at signoff qualify.
insert into public.billing_worker_usage(company_id,month,worker_id,review_event_id,assignment_id,created_at)
select distinct on(e.company_id,date_trunc('month',e.created_at at time zone 'UTC')::date,l.worker_id)
 e.company_id,date_trunc('month',e.created_at at time zone 'UTC')::date,l.worker_id,e.id,(select b.id from public.billing_company_events b where b.company_id=e.company_id and b.action='assign' and b.created_at<=e.created_at order by b.revision desc limit 1),e.created_at
from public.payroll_review_events e join public.calculation_lines l on l.company_id=e.company_id and l.calculation_id=e.calculation_id join public.companies c on c.id=e.company_id
where e.action='SIGNOFF' and not c.is_demo and not c.is_sandbox and coalesce((select b.usage_enabled from public.billing_company_events b where b.company_id=e.company_id and b.action='assign' and b.created_at<=e.created_at order by b.revision desc limit 1),false)
order by e.company_id,date_trunc('month',e.created_at at time zone 'UTC')::date,l.worker_id,e.created_at,e.id on conflict do nothing;

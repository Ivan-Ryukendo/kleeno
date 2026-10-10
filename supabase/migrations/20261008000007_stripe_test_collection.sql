-- Owner-approved TEST collection only. Amount/source snapshots encrypted; uncertain writes never replay automatically.
create table public.billing_collection_commands (
 id uuid primary key, company_id uuid not null references public.companies(id), actor_id uuid not null references auth.users(id),
 action text not null check(action in ('checkout','cancel','usage')), month date check(month is null or extract(day from month)=1),
 command_key uuid not null, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'), payload_enc text not null,
 usage_refs jsonb not null default '[]', status text not null default 'READY' check(status in ('READY','IN_FLIGHT','UNKNOWN','DONE')),
 stage integer not null default 0 check(stage between 0 and 3), token uuid, revision integer not null default 0,
 invoice_id text check(invoice_id ~ '^in_[A-Za-z0-9_]+$'), item_id text check(item_id ~ '^ii_[A-Za-z0-9_]+$'),
 checkout_id text check(checkout_id ~ '^cs_test_[A-Za-z0-9_]+$'), invoice_status text, created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,command_key),check((action='usage')=(month is not null))
);
create unique index billing_closed_month_once on public.billing_collection_commands(company_id,month) where action='usage';
create unique index billing_checkout_once on public.billing_collection_commands(company_id) where action='checkout';
create table public.billing_collection_events (
 id uuid primary key,company_id uuid not null,command_id uuid not null,revision integer not null,stage integer not null,
 status text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(company_id,command_id) references public.billing_collection_commands(company_id,id),unique(command_id,revision)
);
alter table public.billing_collection_commands enable row level security;
alter table public.billing_collection_events enable row level security;
revoke all on public.billing_collection_commands,public.billing_collection_events from public,anon,authenticated,service_role;
grant select on public.billing_collection_commands,public.billing_collection_events to service_role,authenticated;
create policy collection_owner on public.billing_collection_commands for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_collection_commands.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create policy collection_event_owner on public.billing_collection_events for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_collection_events.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create trigger collection_event_immutable before update or delete on public.billing_collection_events for each row execute function public.forbid_change();
create trigger collection_event_no_truncate before truncate on public.billing_collection_events for each statement execute function public.forbid_change();

create function public.prepare_billing_collection(p_company uuid,p_actor uuid,p_id uuid,p_action text,p_month date,p_key uuid,p_hash text,p_payload text,p_usage jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_collection_commands%rowtype; actual jsonb;
begin
 perform 1 from public.companies where id=p_company and not is_demo and not is_sandbox for update;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 select * into c from public.billing_collection_commands where company_id=p_company and command_key=p_key;
 if found then
  if c.actor_id<>p_actor or c.command_hash<>p_hash then return jsonb_build_object('code','CONFLICT'); end if;
  return jsonb_build_object('code','OK','id',c.id);
 end if;
 if p_action='usage' then
  if p_month is null or p_month>=date_trunc('month',clock_timestamp() at time zone 'UTC')::date or exists(select 1 from public.billing_collection_commands where company_id=p_company and month=p_month) then return jsonb_build_object('code','CONFLICT'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'assignmentId',assignment_id) order by worker_id),'[]') into actual from public.billing_worker_usage where company_id=p_company and month=p_month;
  if actual is distinct from p_usage then return jsonb_build_object('code','CONFLICT'); end if;
 end if;
 if p_action<>'checkout' and not exists(select 1 from public.billing_provider_state where company_id=p_company and customer_id is not null and subscription_id is not null) then return jsonb_build_object('code','CONFLICT'); end if;
 if p_action='checkout' and exists(select 1 from public.billing_collection_commands where company_id=p_company and action='checkout') then return jsonb_build_object('code','CONFLICT'); end if;
 insert into public.billing_collection_commands(id,company_id,actor_id,action,month,command_key,command_hash,payload_enc,usage_refs) values(p_id,p_company,p_actor,p_action,p_month,p_key,p_hash,p_payload,p_usage);
 return jsonb_build_object('code','OK','id',p_id);
end $$;
create function public.claim_billing_collection(p_company uuid,p_actor uuid,p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_collection_commands%rowtype; actual jsonb;
begin
 perform 1 from public.companies where id=p_company for update;
 select * into c from public.billing_collection_commands where company_id=p_company and id=p_id for update;
 if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 if c.status='DONE' then return jsonb_build_object('code','DONE'); end if;
 if c.status<>'READY' then return jsonb_build_object('code','UNKNOWN'); end if;
 if c.action='usage' then
  select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'assignmentId',assignment_id) order by worker_id),'[]') into actual from public.billing_worker_usage where company_id=p_company and month=c.month;
  if actual is distinct from c.usage_refs then return jsonb_build_object('code','CONFLICT'); end if;
 end if;
 update public.billing_collection_commands set status='IN_FLIGHT',token=p_token,revision=revision+1 where id=p_id returning * into c;
 insert into public.billing_collection_events values(gen_random_uuid(),p_company,p_id,c.revision,c.stage,c.status,p_actor,now());
 return jsonb_build_object('code','OK','stage',c.stage);
end $$;
create function public.finish_billing_collection(p_company uuid,p_actor uuid,p_id uuid,p_token uuid,p_stage integer,p_refs jsonb,p_done boolean,p_correlation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.billing_collection_commands%rowtype; binding public.billing_provider_state%rowtype; actual jsonb;
begin
 perform 1 from public.companies where id=p_company for update;
 select * into c from public.billing_collection_commands where company_id=p_company and id=p_id for update;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 if c.token is distinct from p_token or c.status not in ('IN_FLIGHT','UNKNOWN') or c.stage is distinct from p_stage then return jsonb_build_object('code','CONFLICT'); end if;
 if c.action='usage' then
  select coalesce(jsonb_agg(jsonb_build_object('workerId',worker_id,'assignmentId',assignment_id) order by worker_id),'[]') into actual from public.billing_worker_usage where company_id=p_company and month=c.month;
  if actual is distinct from c.usage_refs then return jsonb_build_object('code','CONFLICT'); end if;
 end if;
 if c.action='checkout' then
  select * into binding from public.billing_provider_state where company_id=p_company for update;
  if binding.intent_id::text is distinct from p_refs->>'intentId' or (binding.checkout_id is not null and binding.checkout_id is distinct from p_refs->>'checkoutId') then return jsonb_build_object('code','CONFLICT'); end if;
  update public.billing_provider_state set checkout_id=p_refs->>'checkoutId',reconciliation_pending=true where company_id=p_company;
 elsif c.action='cancel' then
  update public.billing_provider_state set reconciliation_pending=true where company_id=p_company and subscription_id=p_refs->>'subscriptionId';
  if not found then return jsonb_build_object('code','CONFLICT'); end if;
 end if;
 update public.billing_collection_commands set revision=revision+1,stage=stage+1,status=case when p_done then 'DONE' else 'READY' end,token=null,
 invoice_id=coalesce(p_refs->>'invoiceId',invoice_id),item_id=coalesce(p_refs->>'itemId',item_id),checkout_id=coalesce(p_refs->>'checkoutId',checkout_id),invoice_status=coalesce(p_refs->>'invoiceStatus',invoice_status) where id=p_id returning * into c;
 insert into public.billing_collection_events values(gen_random_uuid(),p_company,p_id,c.revision,c.stage,c.status,p_actor,now());
 insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs) values(p_company,'billing.test_command_observed','billing_command',p_id,p_actor::text,'user',p_correlation,jsonb_build_object('stage',c.stage,'status',c.status));
 return jsonb_build_object('code','OK');
end $$;
create function public.mark_billing_collection_unknown(p_company uuid,p_actor uuid,p_id uuid,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.billing_collection_commands%rowtype;
begin
 update public.billing_collection_commands set status='UNKNOWN',revision=revision+1 where company_id=p_company and id=p_id and token=p_token and status='IN_FLIGHT' returning * into c;
 if found then insert into public.billing_collection_events values(gen_random_uuid(),p_company,p_id,c.revision,c.stage,c.status,p_actor,now()); end if;
end $$;
revoke all on function public.prepare_billing_collection(uuid,uuid,uuid,text,date,uuid,text,text,jsonb),public.claim_billing_collection(uuid,uuid,uuid,uuid),public.finish_billing_collection(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text),public.mark_billing_collection_unknown(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_billing_collection(uuid,uuid,uuid,text,date,uuid,text,text,jsonb),public.claim_billing_collection(uuid,uuid,uuid,uuid),public.finish_billing_collection(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text),public.mark_billing_collection_unknown(uuid,uuid,uuid,uuid) to service_role;

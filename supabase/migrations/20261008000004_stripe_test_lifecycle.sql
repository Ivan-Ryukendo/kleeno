-- TEST-only observed provider lifecycle. No software/payroll entitlement is granted.
create table public.billing_provider_state (
 company_id uuid primary key references public.companies(id), intent_id uuid not null unique, assignment_id uuid not null,
 checkout_id text unique check(checkout_id ~ '^cs_test_[A-Za-z0-9_]+$'), customer_id text unique check(customer_id ~ '^cus_[A-Za-z0-9_]+$'), subscription_id text unique check(subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
 revision integer not null default 0, receipt_seq bigint not null default 0, reconciliation_pending boolean not null default false,
 lease_token uuid, lease_until timestamptz, lease_seq bigint, status text not null default 'UNKNOWN' check(status in ('UNKNOWN','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused','CHECKOUT_EXPIRED')),
 cancel_at_period_end boolean not null default false, collection_paused boolean not null default false, invoice_id text check(invoice_id ~ '^in_[A-Za-z0-9_]+$'), invoice_status text check(invoice_status in ('draft','open','paid','uncollectible','void')),
 observed_at timestamptz, created_by uuid not null references auth.users(id), command_key uuid not null, command_hash text not null check(command_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 foreign key(company_id,assignment_id) references public.billing_company_events(company_id,id)
);
create table growth.billing_webhook_receipts (
 event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9_]+$'), body_hash text not null check(body_hash ~ '^[a-f0-9]{64}$'),
 event_type text not null, company_id uuid references public.companies(id), refs_enc text, created_at timestamptz not null default now(),
 check((company_id is null and refs_enc is null) or (company_id is not null and refs_enc is not null))
);
create table public.billing_provider_observations (
 id uuid primary key, company_id uuid not null references public.companies(id), revision integer not null check(revision>0), receipt_seq bigint not null,
 status text not null, cancel_at_period_end boolean not null, collection_paused boolean not null, subscription_id text, customer_id text, invoice_id text, invoice_status text, observed_at timestamptz not null default now(),
 unique(company_id,id), unique(company_id,revision)
);
alter table public.billing_provider_state enable row level security;
alter table public.billing_provider_observations enable row level security;
alter table growth.billing_webhook_receipts enable row level security;
revoke all on public.billing_provider_state,public.billing_provider_observations,growth.billing_webhook_receipts from public,anon,authenticated,service_role;
grant select on public.billing_provider_state,public.billing_provider_observations to authenticated;
grant select on public.billing_provider_state,public.billing_provider_observations,growth.billing_webhook_receipts to service_role;
create policy provider_owner on public.billing_provider_state for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_provider_state.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create policy provider_history_owner on public.billing_provider_observations for select to authenticated using(company_id=(select public.current_company_id()) and exists(select 1 from public.memberships m where m.company_id=billing_provider_observations.company_id and m.user_id=(select auth.uid()) and m.removed_at is null and 'OWNER'=any(m.roles)));
create trigger billing_receipt_immutable before update or delete on growth.billing_webhook_receipts for each row execute function public.forbid_change();
create trigger billing_receipt_no_truncate before truncate on growth.billing_webhook_receipts for each statement execute function public.forbid_change();
create trigger billing_observation_immutable before update or delete on public.billing_provider_observations for each row execute function public.forbid_change();
create trigger billing_observation_no_truncate before truncate on public.billing_provider_observations for each statement execute function public.forbid_change();

-- Creates a server-owned binding intent only. Checkout remains policy gated in the application.
create function public.begin_stripe_test_checkout(p_company uuid,p_actor uuid,p_intent uuid,p_assignment uuid,p_key uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_provider_state%rowtype;
begin
 perform 1 from public.companies where id=p_company and not is_demo and not is_sandbox for update;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 select * into s from public.billing_provider_state where company_id=p_company;
 if found then
  if s.command_key=p_key and s.command_hash=p_hash and s.created_by=p_actor then return jsonb_build_object('code','OK','intentId',s.intent_id); end if;
  return jsonb_build_object('code','CONFLICT');
 end if;
 perform 1 from public.billing_company_events where company_id=p_company and id=p_assignment and action='assign' and usage_enabled;
 if not found or p_assignment is distinct from (select id from public.billing_company_events where company_id=p_company and action='assign' order by revision desc limit 1) then return jsonb_build_object('code','CONFLICT'); end if;
 insert into public.billing_provider_state(company_id,intent_id,assignment_id,created_by,command_key,command_hash) values(p_company,p_intent,p_assignment,p_actor,p_key,p_hash);
 return jsonb_build_object('code','OK','intentId',p_intent);
end $$;
create function public.bind_stripe_test_checkout(p_company uuid,p_actor uuid,p_intent uuid,p_session text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_provider_state%rowtype;
begin
 select * into s from public.billing_provider_state where company_id=p_company for update;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' or s.intent_id is distinct from p_intent or (s.checkout_id is not null and s.checkout_id<>p_session) then return jsonb_build_object('code','CONFLICT'); end if;
 update public.billing_provider_state set checkout_id=p_session,reconciliation_pending=true where company_id=p_company;
 return jsonb_build_object('code','OK');
end $$;
create function public.record_stripe_test_receipt(p_company uuid,p_event text,p_hash text,p_type text,p_object text,p_customer text,p_subscription text,p_refs_enc text) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior growth.billing_webhook_receipts%rowtype; s public.billing_provider_state%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event,81008004));
 select * into prior from growth.billing_webhook_receipts where event_id=p_event;
 if found then
  if prior.body_hash<>p_hash or prior.event_type<>p_type then return jsonb_build_object('code','CONFLICT'); end if;
  return jsonb_build_object('code','OK','duplicate',true);
 end if;
 if p_company is not null then
  select * into s from public.billing_provider_state where company_id=p_company for update;
  if not found or not coalesce((s.checkout_id=p_object or s.subscription_id=p_object or (s.subscription_id=p_subscription and s.customer_id=p_customer)),false)
   or (s.customer_id is not null and p_customer is not null and s.customer_id<>p_customer) then return jsonb_build_object('code','CONFLICT'); end if;
  update public.billing_provider_state set receipt_seq=receipt_seq+1,reconciliation_pending=true where company_id=p_company;
 end if;
 insert into growth.billing_webhook_receipts(event_id,body_hash,event_type,company_id,refs_enc) values(p_event,p_hash,p_type,p_company,p_refs_enc);
 return jsonb_build_object('code','OK','duplicate',false,'matched',p_company is not null);
end $$;
create function public.claim_stripe_test_reconciliation(p_company uuid,p_actor uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_provider_state%rowtype;
begin
 select * into s from public.billing_provider_state where company_id=p_company for update;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 if s.company_id is null or s.checkout_id is null then return jsonb_build_object('code','NOT_LINKED'); end if;
 if s.lease_until>now() then return jsonb_build_object('code','BUSY'); end if;
 -- Explicit refresh also reconciles missed events; event timestamp ordering is never used.
 update public.billing_provider_state set lease_token=p_token,lease_until=now()+interval '60 seconds',lease_seq=receipt_seq,reconciliation_pending=true where company_id=p_company;
 return jsonb_build_object('code','OK','state',jsonb_build_object('intentId',s.intent_id,'checkoutId',s.checkout_id,'customerId',s.customer_id,'subscriptionId',s.subscription_id,'seq',s.receipt_seq));
end $$;
create function public.finish_stripe_test_reconciliation(p_company uuid,p_actor uuid,p_token uuid,p_seq bigint,p_observation jsonb,p_correlation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.billing_provider_state%rowtype; oid uuid:=gen_random_uuid();
begin
 select * into s from public.billing_provider_state where company_id=p_company for update;
 perform 1 from public.memberships where company_id=p_company and user_id=p_actor and removed_at is null and 'OWNER'=any(roles) for share;
 if not found then return jsonb_build_object('code','FORBIDDEN'); end if;
 if s.lease_token is distinct from p_token or s.lease_until<=now() or s.lease_seq is distinct from p_seq then return jsonb_build_object('code','CONFLICT'); end if;
 if s.receipt_seq<>p_seq then
  update public.billing_provider_state set lease_token=null,lease_until=null,lease_seq=null where company_id=p_company;
  return jsonb_build_object('code','CONFLICT');
 end if;
 if p_observation->>'checkoutId' is distinct from s.checkout_id or (p_observation->>'intentId')::uuid is distinct from s.intent_id
  or (s.customer_id is not null and s.customer_id is distinct from p_observation->>'customerId') or (s.subscription_id is not null and s.subscription_id is distinct from p_observation->>'subscriptionId') then return jsonb_build_object('code','CONFLICT'); end if;
 update public.billing_provider_state set revision=revision+1,status=p_observation->>'status',customer_id=p_observation->>'customerId',subscription_id=p_observation->>'subscriptionId',cancel_at_period_end=(p_observation->>'cancelAtPeriodEnd')::boolean,collection_paused=(p_observation->>'collectionPaused')::boolean,
 invoice_id=p_observation->>'invoiceId',invoice_status=p_observation->>'invoiceStatus',observed_at=now(),reconciliation_pending=false,lease_token=null,lease_until=null,lease_seq=null where company_id=p_company returning * into s;
 insert into public.billing_provider_observations(id,company_id,revision,receipt_seq,status,cancel_at_period_end,collection_paused,subscription_id,customer_id,invoice_id,invoice_status)
 values(oid,p_company,s.revision,p_seq,s.status,s.cancel_at_period_end,s.collection_paused,s.subscription_id,s.customer_id,s.invoice_id,s.invoice_status);
 insert into public.audit_events(company_id,event,entity_type,entity_id,actor,actor_type,correlation_id,refs) values(p_company,'billing.provider_reconciled','billing_provider',oid,p_actor::text,'user',p_correlation,jsonb_build_object('version',s.revision));
 return jsonb_build_object('code','OK','revision',s.revision);
end $$;
create function public.fail_stripe_test_reconciliation(p_company uuid,p_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.billing_provider_state set lease_token=null,lease_until=null,lease_seq=null,reconciliation_pending=true where company_id=p_company and lease_token=p_token; end $$;
revoke all on function public.begin_stripe_test_checkout(uuid,uuid,uuid,uuid,uuid,text),public.bind_stripe_test_checkout(uuid,uuid,uuid,text),public.record_stripe_test_receipt(uuid,text,text,text,text,text,text,text),public.claim_stripe_test_reconciliation(uuid,uuid,uuid),public.finish_stripe_test_reconciliation(uuid,uuid,uuid,bigint,jsonb,text),public.fail_stripe_test_reconciliation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_stripe_test_checkout(uuid,uuid,uuid,uuid,uuid,text),public.bind_stripe_test_checkout(uuid,uuid,uuid,text),public.record_stripe_test_receipt(uuid,text,text,text,text,text,text,text),public.claim_stripe_test_reconciliation(uuid,uuid,uuid),public.finish_stripe_test_reconciliation(uuid,uuid,uuid,bigint,jsonb,text),public.fail_stripe_test_reconciliation(uuid,uuid) to service_role;

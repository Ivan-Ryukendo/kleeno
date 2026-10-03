-- P4 slice 3: Circle webhook notifications are hints, deduplicated here (rule 49, S27); a Circle transaction belongs to one attempt.

create unique index payment_attempts_circle_tx_key on public.payment_attempts (circle_tx_id) where circle_tx_id is not null;

create table public.webhook_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  provider text not null check (provider = 'circle'),
  notification_id text not null,
  circle_tx_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, notification_id),
  unique (company_id, id)
);
create index webhook_notifications_company_idx on public.webhook_notifications (company_id, created_at);

alter table public.webhook_notifications enable row level security;
revoke all on public.webhook_notifications from anon, authenticated;
grant select on public.webhook_notifications to authenticated;
grant all on public.webhook_notifications to service_role;
create policy webhook_notifications_select_own_company on public.webhook_notifications for select to authenticated
  using (company_id = (select public.current_company_id()));
create trigger webhook_notifications_immutable before update or delete on public.webhook_notifications for each row execute function public.forbid_change();
create trigger webhook_notifications_no_truncate before truncate on public.webhook_notifications for each statement execute function public.forbid_change();

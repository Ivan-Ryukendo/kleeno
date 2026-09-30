-- Synthetic data only (rule 42). No credentials. Fixed IDs so scripts can find the companies.
insert into public.companies (id, name, is_demo, live_payments_enabled, per_payment_ceiling)
values
  ('00000000-0000-4000-8000-000000000001', 'Demo Co (synthetic)', true, false, 100000000),
  ('00000000-0000-4000-8000-000000000002', 'Pilot Co (synthetic dev)', false, false, 100000000)
on conflict (id) do nothing;

-- Batches are born PROPOSED (initial-state trigger from 000003).
alter table public.payment_batches alter column status set default 'PROPOSED';

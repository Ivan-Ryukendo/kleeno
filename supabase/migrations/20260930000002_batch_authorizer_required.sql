-- P1 review (finding 3): a batch that is authorized or later must name its authorizer.
alter table public.payment_batches
  add constraint payment_batches_authorizer_required
  check (status in ('PROPOSED', 'DISCARDED') or authorizer_id is not null);

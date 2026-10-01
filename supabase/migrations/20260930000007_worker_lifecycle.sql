-- Worker lifecycle: why a compensation version was made (promotion, raise...) and when/why a worker left.
-- Workers are never deleted: runs, obligations and audit reference them. Leaving = active false + left_on/left_reason.
alter table public.compensations add column reason text not null default 'INITIAL'
  check (reason in ('INITIAL', 'PROMOTION', 'RAISE', 'ROLE_CHANGE', 'CORRECTION'));
alter table public.workers add column left_on date;
alter table public.workers add column left_reason text check (left_reason in ('RESIGNED', 'TERMINATED', 'CONTRACT_ENDED', 'OTHER'));
alter table public.workers add constraint workers_left_consistent
  check ((active and left_on is null and left_reason is null) or (not active and left_on is not null and left_reason is not null));

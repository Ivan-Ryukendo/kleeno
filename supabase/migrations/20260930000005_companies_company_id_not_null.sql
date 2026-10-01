-- S10: the generated company_id of companies is provably never null.
alter table public.companies alter column company_id set not null;

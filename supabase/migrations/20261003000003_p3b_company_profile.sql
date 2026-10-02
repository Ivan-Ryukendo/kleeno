-- P3b slice 3: the company profile the onboarding wizard collects. Not secret (legal details, address and tax ID come later,
-- encrypted). Currency stays USD. Companies that existed before the wizard count as onboarded.

alter table public.companies
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column timezone text check (length(timezone) between 3 and 64),
  add column size_range text check (size_range in ('1_10', '11_50', '51_200', '201_1000', '1000_PLUS')),
  add column industry text check (industry in ('SOFTWARE', 'AGENCY', 'FINANCE', 'HEALTHCARE', 'EDUCATION', 'RETAIL', 'CONSTRUCTION', 'MANUFACTURING', 'NONPROFIT', 'OTHER')),
  add column pay_frequency text check (pay_frequency in ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY')),
  add column pay_day smallint check (pay_day between 1 and 31), -- monthly: day of month; weekly/biweekly: ISO weekday (1 = Monday); semi-monthly: none
  add column onboarded_at timestamptz;

update public.companies set onboarded_at = created_at where onboarded_at is null;

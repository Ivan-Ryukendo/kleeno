-- Platform account preference, global across company memberships; server-only like other growth data.
create table growth.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text check(timezone is null or length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);
alter table growth.user_preferences enable row level security;
revoke all on growth.user_preferences from public,anon,authenticated;
grant select,insert,update on growth.user_preferences to service_role;

create function growth.validate_user_timezone() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.timezone is not null and (
    (new.timezone <> 'UTC' and position('/' in new.timezone)=0)
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone)
  ) then raise exception 'invalid IANA timezone' using errcode='22023'; end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function growth.validate_user_timezone() from public,anon,authenticated;
create trigger user_timezone_valid before insert or update on growth.user_preferences
for each row execute function growth.validate_user_timezone();

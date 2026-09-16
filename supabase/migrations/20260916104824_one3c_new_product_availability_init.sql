-- ONE-3C hardening — initialize every newly ONE-managed Hub product at IN_STOCK v0.
-- Required because ONE-2B product shells can be created after the ONE-3C baseline migration.

create or replace function private.one3c_initialize_availability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.one_managed, false) and new.one_availability is null then
    new.one_availability := 'IN_STOCK';
    new.one_availability_version := 0;
    new.one_availability_updated_at := coalesce(new.one_availability_updated_at, now());
    new.one_availability_last_reason := coalesce(new.one_availability_last_reason, 'ONE3_INITIALIZED');
  end if;
  return new;
end;
$$;

revoke all on function private.one3c_initialize_availability() from public;

drop trigger if exists trg_one3c_initialize_availability on public.products;
create trigger trg_one3c_initialize_availability
before insert or update of one_managed on public.products
for each row
execute function private.one3c_initialize_availability();

comment on function private.one3c_initialize_availability() is
  'AMPHON ONE-3C: initialize newly ONE-managed Product Hub shells to System-projection baseline IN_STOCK v0.';

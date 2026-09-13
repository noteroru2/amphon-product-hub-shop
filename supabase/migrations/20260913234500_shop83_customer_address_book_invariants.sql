-- AMPHON SHOP — SHOP-8.3 Customer Profile + Thai Address Book invariants
-- Generated 2026-09-13
-- Scope: customer-owned profile/address safety only.
-- Does NOT enable member-required checkout or modify payment settings.

create or replace function public.set_customer_default_address(target_address_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owned_customer_id uuid;
begin
  select cp.id
    into owned_customer_id
    from public.commerce_customer_profiles cp
   where cp.auth_user_id = auth.uid()
     and cp.status = 'ACTIVE';

  if owned_customer_id is null then
    raise exception 'CUSTOMER_PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1
      from public.commerce_customer_addresses a
     where a.id = target_address_id
       and a.customer_id = owned_customer_id
       and a.is_active = true
  ) then
    raise exception 'ADDRESS_NOT_FOUND';
  end if;

  update public.commerce_customer_addresses
     set is_default = false
   where customer_id = owned_customer_id
     and is_default = true
     and id <> target_address_id;

  update public.commerce_customer_addresses
     set is_default = true
   where id = target_address_id
     and customer_id = owned_customer_id
     and is_active = true;
end;
$$;

revoke all on function public.set_customer_default_address(uuid) from public, anon;
grant execute on function public.set_customer_default_address(uuid) to authenticated;

create or replace function public.delete_customer_address(target_address_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owned_customer_id uuid;
  was_default boolean := false;
  fallback_address_id uuid;
begin
  select cp.id
    into owned_customer_id
    from public.commerce_customer_profiles cp
   where cp.auth_user_id = auth.uid()
     and cp.status = 'ACTIVE';

  if owned_customer_id is null then
    raise exception 'CUSTOMER_PROFILE_NOT_FOUND';
  end if;

  select a.is_default
    into was_default
    from public.commerce_customer_addresses a
   where a.id = target_address_id
     and a.customer_id = owned_customer_id;

  if not found then
    raise exception 'ADDRESS_NOT_FOUND';
  end if;

  delete from public.commerce_customer_addresses
   where id = target_address_id
     and customer_id = owned_customer_id;

  if coalesce(was_default, false) then
    select a.id
      into fallback_address_id
      from public.commerce_customer_addresses a
     where a.customer_id = owned_customer_id
       and a.is_active = true
     order by a.updated_at desc, a.created_at desc
     limit 1;

    if fallback_address_id is not null then
      update public.commerce_customer_addresses
         set is_default = true
       where id = fallback_address_id
         and customer_id = owned_customer_id;
    end if;
  end if;
end;
$$;

revoke all on function public.delete_customer_address(uuid) from public, anon;
grant execute on function public.delete_customer_address(uuid) to authenticated;

comment on function public.set_customer_default_address(uuid) is
'SHOP-8.3: atomically sets one active address owned by auth.uid() as the customer default.';
comment on function public.delete_customer_address(uuid) is
'SHOP-8.3: deletes one address owned by auth.uid(); when default is removed, promotes a remaining active address.';

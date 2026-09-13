-- AMPHON SHOP — SHOP-8.0 Customer Identity Architecture
-- Generated 2026-09-13
-- IMPORTANT: schema only. This migration does NOT enable member-required checkout.
-- It is intentionally forward-only and does not modify Stripe, PromptPay, purchase_enabled,
-- reservations, payment state, or existing order behavior.
--
-- Goals
-- 1) Separate customer identities from Product Hub staff identities.
-- 2) Default every normal new Supabase Auth user to CUSTOMER, never staff.
-- 3) Allow future staff provisioning only through server-controlled app_metadata.
-- 4) Add customer profile/address ownership with RLS.
-- 5) Prepare nullable order ownership/snapshot columns for a staged migration from guest checkout.
-- 6) Keep member_checkout_required = false until SHOP-8.5 acceptance.

create extension if not exists pgcrypto;
create schema if not exists private;

-- -----------------------------------------------------------------------------
-- CUSTOMER PROFILE
-- -----------------------------------------------------------------------------

create table if not exists public.commerce_customer_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  display_name text,
  phone text,
  email_verified_at timestamptz,
  auth_provider text not null default 'email',
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_customer_profiles_email_ci_uidx
on public.commerce_customer_profiles(lower(email))
where email is not null and btrim(email) <> '';

create index if not exists commerce_customer_profiles_auth_user_idx
on public.commerce_customer_profiles(auth_user_id);

comment on table public.commerce_customer_profiles is
'Customer-only profile table for AMPHON SHOP. Staff authorization continues to use public.profiles.';

-- -----------------------------------------------------------------------------
-- THAI SHIPPING ADDRESS BOOK
-- -----------------------------------------------------------------------------

create table if not exists public.commerce_customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.commerce_customer_profiles(id) on delete cascade,
  label text not null default 'บ้าน',
  recipient_name text not null,
  phone text not null,
  address_line1 text not null,
  address_line2 text,
  subdistrict text not null,
  district text not null,
  province text not null,
  postal_code text not null,
  country_code text not null default 'TH',
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (char_length(btrim(recipient_name)) between 2 and 120),
  check (char_length(regexp_replace(phone, '[^0-9+]', '', 'g')) between 8 and 30),
  check (char_length(btrim(address_line1)) between 1 and 250),
  check (char_length(btrim(subdistrict)) between 1 and 120),
  check (char_length(btrim(district)) between 1 and 120),
  check (char_length(btrim(province)) between 1 and 120),
  check (postal_code ~ '^[0-9]{5}$'),
  check (country_code = 'TH')
);

create index if not exists commerce_customer_addresses_customer_idx
on public.commerce_customer_addresses(customer_id, is_active, created_at desc);

create unique index if not exists commerce_customer_addresses_one_default_uidx
on public.commerce_customer_addresses(customer_id)
where is_default = true and is_active = true;

comment on table public.commerce_customer_addresses is
'Thailand shipping-address book owned by a commerce customer. Checkout will snapshot selected address data into the order.';

-- -----------------------------------------------------------------------------
-- TOUCH TRIGGERS
-- -----------------------------------------------------------------------------

create or replace function private.touch_commerce_customer_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_commerce_customer_row() from public, anon, authenticated;

drop trigger if exists commerce_customer_profiles_touch on public.commerce_customer_profiles;
create trigger commerce_customer_profiles_touch
before update on public.commerce_customer_profiles
for each row execute procedure private.touch_commerce_customer_row();

drop trigger if exists commerce_customer_addresses_touch on public.commerce_customer_addresses;
create trigger commerce_customer_addresses_touch
before update on public.commerce_customer_addresses
for each row execute procedure private.touch_commerce_customer_row();

-- -----------------------------------------------------------------------------
-- STAFF / CUSTOMER AUTH SEPARATION
-- -----------------------------------------------------------------------------
-- SECURITY MODEL:
-- - raw_user_meta_data is user-controlled and MUST NEVER grant staff access.
-- - raw_app_meta_data is server/admin-controlled and may explicitly mark a future user as staff.
-- - Existing staff accounts are preserved because they already exist in public.profiles.
-- - New normal Email/Password or Google users become SHOP customers only.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_type text;
  staff_role text;
  resolved_name text;
  resolved_provider text;
begin
  account_type := lower(coalesce(new.raw_app_meta_data ->> 'account_type', 'customer'));
  staff_role := lower(coalesce(new.raw_app_meta_data ->> 'amphon_role', 'sales'));
  if staff_role not in ('owner','admin','sales','technician') then
    staff_role := 'sales';
  end if;

  resolved_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    case when account_type = 'staff' then 'พนักงาน' else 'ลูกค้า' end
  );
  resolved_provider := lower(coalesce(nullif(new.raw_app_meta_data ->> 'provider', ''), 'email'));

  if account_type = 'staff' then
    insert into public.profiles (id, display_name, role, active)
    values (new.id, resolved_name, staff_role, true)
    on conflict (id) do nothing;
  else
    insert into public.commerce_customer_profiles (
      auth_user_id,
      email,
      display_name,
      email_verified_at,
      auth_provider,
      status
    )
    values (
      new.id,
      nullif(lower(btrim(coalesce(new.email, ''))), ''),
      resolved_name,
      new.email_confirmed_at,
      resolved_provider,
      'ACTIVE'
    )
    on conflict (auth_user_id) do update
      set email = excluded.email,
          display_name = coalesce(public.commerce_customer_profiles.display_name, excluded.display_name),
          email_verified_at = excluded.email_verified_at,
          auth_provider = excluded.auth_provider,
          updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Keep customer auth identity fields synchronized with verified Supabase Auth state.
create or replace function private.sync_commerce_customer_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.commerce_customer_profiles
     set email = nullif(lower(btrim(coalesce(new.email, ''))), ''),
         email_verified_at = new.email_confirmed_at,
         auth_provider = lower(coalesce(nullif(new.raw_app_meta_data ->> 'provider', ''), auth_provider, 'email')),
         updated_at = now()
   where auth_user_id = new.id;
  return new;
end;
$$;

revoke all on function private.sync_commerce_customer_auth_identity() from public, anon, authenticated;

drop trigger if exists on_auth_customer_identity_updated on auth.users;
create trigger on_auth_customer_identity_updated
after update of email, email_confirmed_at, raw_app_meta_data on auth.users
for each row execute procedure private.sync_commerce_customer_auth_identity();

-- Backfill customer profiles only for Auth users that are NOT existing Product Hub staff.
-- This intentionally treats all existing public.profiles rows as staff to avoid privilege drift.
insert into public.commerce_customer_profiles (
  auth_user_id,
  email,
  display_name,
  email_verified_at,
  auth_provider,
  status
)
select
  u.id,
  nullif(lower(btrim(coalesce(u.email, ''))), ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'ลูกค้า'
  ),
  u.email_confirmed_at,
  lower(coalesce(nullif(u.raw_app_meta_data ->> 'provider', ''), 'email')),
  'ACTIVE'
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (auth_user_id) do nothing;

-- -----------------------------------------------------------------------------
-- CUSTOMER RLS
-- -----------------------------------------------------------------------------

alter table public.commerce_customer_profiles enable row level security;
alter table public.commerce_customer_addresses enable row level security;

revoke all on public.commerce_customer_profiles from anon, authenticated;
revoke all on public.commerce_customer_addresses from anon, authenticated;

grant select on public.commerce_customer_profiles to authenticated;
grant update(display_name, phone) on public.commerce_customer_profiles to authenticated;
grant select, insert, update, delete on public.commerce_customer_addresses to authenticated;

drop policy if exists commerce_customer_profiles_read_self on public.commerce_customer_profiles;
drop policy if exists commerce_customer_profiles_update_self on public.commerce_customer_profiles;
drop policy if exists commerce_customer_addresses_read_self on public.commerce_customer_addresses;
drop policy if exists commerce_customer_addresses_insert_self on public.commerce_customer_addresses;
drop policy if exists commerce_customer_addresses_update_self on public.commerce_customer_addresses;
drop policy if exists commerce_customer_addresses_delete_self on public.commerce_customer_addresses;

create policy commerce_customer_profiles_read_self
on public.commerce_customer_profiles
for select to authenticated
using (auth_user_id = auth.uid());

create policy commerce_customer_profiles_update_self
on public.commerce_customer_profiles
for update to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

create policy commerce_customer_addresses_read_self
on public.commerce_customer_addresses
for select to authenticated
using (
  exists (
    select 1
    from public.commerce_customer_profiles cp
    where cp.id = customer_id
      and cp.auth_user_id = auth.uid()
      and cp.status = 'ACTIVE'
  )
);

create policy commerce_customer_addresses_insert_self
on public.commerce_customer_addresses
for insert to authenticated
with check (
  exists (
    select 1
    from public.commerce_customer_profiles cp
    where cp.id = customer_id
      and cp.auth_user_id = auth.uid()
      and cp.status = 'ACTIVE'
  )
);

create policy commerce_customer_addresses_update_self
on public.commerce_customer_addresses
for update to authenticated
using (
  exists (
    select 1
    from public.commerce_customer_profiles cp
    where cp.id = customer_id
      and cp.auth_user_id = auth.uid()
      and cp.status = 'ACTIVE'
  )
)
with check (
  exists (
    select 1
    from public.commerce_customer_profiles cp
    where cp.id = customer_id
      and cp.auth_user_id = auth.uid()
      and cp.status = 'ACTIVE'
  )
);

create policy commerce_customer_addresses_delete_self
on public.commerce_customer_addresses
for delete to authenticated
using (
  exists (
    select 1
    from public.commerce_customer_profiles cp
    where cp.id = customer_id
      and cp.auth_user_id = auth.uid()
      and cp.status = 'ACTIVE'
  )
);

-- -----------------------------------------------------------------------------
-- ORDER OWNERSHIP + IMMUTABLE CHECKOUT SNAPSHOTS (NULLABLE DURING TRANSITION)
-- -----------------------------------------------------------------------------
-- Existing guest orders remain valid. SHOP-8.5 will require these fields for new orders.

alter table public.commerce_orders
  add column if not exists customer_id uuid references public.commerce_customer_profiles(id) on delete set null,
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists customer_profile_snapshot jsonb,
  add column if not exists shipping_address_snapshot jsonb;

create index if not exists commerce_orders_customer_idx
on public.commerce_orders(customer_id, created_at desc);

create index if not exists commerce_orders_auth_user_idx
on public.commerce_orders(auth_user_id, created_at desc);

comment on column public.commerce_orders.customer_profile_snapshot is
'Immutable customer identity/contact snapshot captured at checkout.';
comment on column public.commerce_orders.shipping_address_snapshot is
'Immutable shipping-address snapshot captured at checkout. Null for pickup.';

-- -----------------------------------------------------------------------------
-- STAGED FEATURE FLAG
-- -----------------------------------------------------------------------------
-- Keep FALSE in SHOP-8.0 so current guest checkout remains live and unchanged.

alter table public.commerce_store_settings
  add column if not exists member_checkout_required boolean not null default false;

update public.commerce_store_settings
   set member_checkout_required = false
 where id = 1
   and member_checkout_required is distinct from false;

comment on column public.commerce_store_settings.member_checkout_required is
'When true, Store API must require a verified authenticated customer before order creation. SHOP-8.0 leaves this false.';

-- -----------------------------------------------------------------------------
-- SERVICE ROLE ACCESS
-- -----------------------------------------------------------------------------
-- Worker continues to be the trusted server boundary for checkout/order access.

grant select, insert, update, delete on public.commerce_customer_profiles to service_role;
grant select, insert, update, delete on public.commerce_customer_addresses to service_role;

-- No policy/grant is added that exposes commerce_orders directly to customer browsers.
-- Future My Orders routes must verify the Bearer token in the Worker and query via service role.

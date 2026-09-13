-- AMPHON Product Hub — Batch 3.2 Product Schema & Smart Form
-- Safe to re-run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'sales' check (role in ('owner','admin','sales','technician')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.product_sku_seq;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  category text not null check (category in ('notebook','pc','iphone','smartphone','tablet','camera','lens','monitor','component','gaming','accessory','other')),
  subtype text,
  brand text,
  model text,
  title text not null,
  serial_number text,
  status text not null default 'draft' check (status in ('draft','photo_ready','ready_to_list','published','reserved','sold','repair','consignment','returned','cancelled')),
  condition_percent smallint check (condition_percent between 0 and 100),
  price numeric(12,2),
  warranty_until date,
  defects text,
  notes text,
  specs jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sold_at timestamptz
);

-- Batch 3.2 schema upgrades for existing projects.
alter table public.products add column if not exists subtype text;
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('notebook','pc','iphone','smartphone','tablet','camera','lens','monitor','component','gaming','accessory','other'));
update public.products
set subtype = case category
  when 'iphone' then 'iphone'
  when 'smartphone' then 'android'
  else 'other'
end
where subtype is null;

create table if not exists public.product_financials (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost numeric(12,2),
  target_margin_percent numeric(6,2),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  object_key text not null,
  public_url text,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  image_role text,
  width integer,
  height integer,
  bytes integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.product_images add column if not exists image_role text;
update public.product_images set image_role = case when is_cover then 'cover' else 'other' end where image_role is null;

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  product_id uuid references public.products(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists products_status_idx on public.products(status);
create index if not exists products_category_idx on public.products(category);
create index if not exists products_subtype_idx on public.products(subtype);
create index if not exists products_serial_idx on public.products(serial_number);
create index if not exists products_updated_idx on public.products(updated_at desc);
create index if not exists product_images_product_idx on public.product_images(product_id, sort_order);

-- Avoid recursive RLS policies on profiles.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active = true limit 1;
$$;

create or replace function public.current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.active from public.profiles p where p.id = auth.uid() limit 1), false);
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_active() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_active() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1), 'พนักงาน'),
    'sales',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Backfill profiles for Auth users that existed before this trigger.
insert into public.profiles (id, display_name, role, active)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'display_name', split_part(coalesce(u.email, ''), '@', 1), 'พนักงาน'),
  'sales',
  true
from auth.users u
on conflict (id) do nothing;

create or replace function public.assign_product_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text;
  seq bigint;
begin
  if new.sku is not null and length(trim(new.sku)) > 0 then
    return new;
  end if;

  prefix := case new.category
    when 'notebook' then 'NB'
    when 'pc' then 'PC'
    when 'iphone' then 'PH'
    when 'smartphone' then 'PH'
    when 'tablet' then 'TB'
    when 'camera' then 'CAM'
    when 'lens' then 'LNS'
    when 'monitor' then 'MON'
    when 'component' then 'CP'
    when 'gaming' then 'GM'
    when 'accessory' then 'AC'
    else 'OT'
  end;
  seq := nextval('public.product_sku_seq');
  new.sku := 'AT-' || prefix || '-' || to_char(now() at time zone 'Asia/Bangkok', 'YYMM') || '-' || lpad(seq::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists products_assign_sku on public.products;
create trigger products_assign_sku
before insert on public.products
for each row execute procedure public.assign_product_sku();

create or replace function public.touch_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'sold' and old.status is distinct from 'sold' then
    new.sold_at := now();
  elsif new.status <> 'sold' and old.status = 'sold' then
    new.sold_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists products_touch on public.products;
create trigger products_touch
before update on public.products
for each row execute procedure public.touch_product();

create or replace function public.touch_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
before update on public.profiles
for each row execute procedure public.touch_profile();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_financials enable row level security;
alter table public.product_images enable row level security;
alter table public.activity_logs enable row level security;

-- Drop previous policies so this file can be applied over Batch 1.
drop policy if exists profiles_read_self_or_admin on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists products_read_authenticated on public.products;
drop policy if exists products_insert_authenticated on public.products;
drop policy if exists products_update_authenticated on public.products;
drop policy if exists products_delete_admin on public.products;
drop policy if exists financials_admin_only on public.product_financials;
drop policy if exists images_read_authenticated on public.product_images;
drop policy if exists images_write_authenticated on public.product_images;
drop policy if exists images_insert_authenticated on public.product_images;
drop policy if exists images_update_authenticated on public.product_images;
drop policy if exists images_delete_authenticated on public.product_images;
drop policy if exists logs_read_admin on public.activity_logs;
drop policy if exists logs_insert_authenticated on public.activity_logs;

create policy profiles_read_self_or_admin on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.current_user_role() in ('owner','admin')
);

create policy products_read_authenticated on public.products
for select to authenticated using (public.current_user_active());

create policy products_insert_authenticated on public.products
for insert to authenticated
with check (public.current_user_active() and created_by = auth.uid() and updated_by = auth.uid());

create policy products_update_authenticated on public.products
for update to authenticated
using (public.current_user_active())
with check (public.current_user_active() and updated_by = auth.uid());

create policy products_delete_admin on public.products
for delete to authenticated
using (public.current_user_role() in ('owner','admin'));

create policy financials_admin_only on public.product_financials
for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy images_read_authenticated on public.product_images
for select to authenticated using (public.current_user_active());

create policy images_insert_authenticated on public.product_images
for insert to authenticated
with check (public.current_user_active() and created_by = auth.uid());

create policy images_update_authenticated on public.product_images
for update to authenticated
using (public.current_user_active())
with check (public.current_user_active());

create policy images_delete_authenticated on public.product_images
for delete to authenticated
using (public.current_user_active());

create policy logs_read_admin on public.activity_logs
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

create policy logs_insert_authenticated on public.activity_logs
for insert to authenticated
with check (public.current_user_active() and actor_id = auth.uid());

-- Realtime: multiple phones/tablets see inventory changes without a refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.products;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.product_images;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- FIRST OWNER SETUP (run manually once after creating the first Auth user):
-- update public.profiles p
-- set role = 'owner'
-- from auth.users u
-- where p.id = u.id and u.email = 'YOUR_EMAIL@example.com';
-- AMPHON Product Hub — Batch 3.3 Production Workflow & Guardrails
-- Run once after Batch 3.2. Safe to re-run.

create or replace function public.normalize_product_identifier(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(value, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

revoke all on function public.normalize_product_identifier(text) from public;
grant execute on function public.normalize_product_identifier(text) to authenticated;

-- Fast lookup for duplicate Serial / IMEI checks.
create index if not exists products_identifier_normalized_idx
on public.products (public.normalize_product_identifier(serial_number));

create or replace function public.find_active_product_by_identifier(identifier_value text)
returns table (
  id uuid,
  sku text,
  title text,
  status text,
  serial_number text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.sku, p.title, p.status, p.serial_number
  from public.products p
  where public.normalize_product_identifier(p.serial_number) = public.normalize_product_identifier(identifier_value)
    and public.normalize_product_identifier(identifier_value) <> ''
    and p.status in ('draft','photo_ready','ready_to_list','published','reserved','repair','consignment')
  order by p.updated_at desc;
$$;

revoke all on function public.find_active_product_by_identifier(text) from public;
grant execute on function public.find_active_product_by_identifier(text) to authenticated;

-- Database-level duplicate protection. Existing duplicate rows are left untouched,
-- but new/changed identifiers cannot create a second active-stock record.
create or replace function public.guard_active_product_identifier()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  normalized text;
begin
  if tg_op = 'UPDATE'
     and public.normalize_product_identifier(new.serial_number) = public.normalize_product_identifier(old.serial_number)
     and new.status = old.status then
    return new;
  end if;

  if new.status not in ('draft','photo_ready','ready_to_list','published','reserved','repair','consignment') then
    return new;
  end if;

  normalized := public.normalize_product_identifier(new.serial_number);
  if normalized = '' then
    return new;
  end if;

  if exists (
    select 1
    from public.products p
    where p.id <> new.id
      and public.normalize_product_identifier(p.serial_number) = normalized
      and p.status in ('draft','photo_ready','ready_to_list','published','reserved','repair','consignment')
  ) then
    raise exception 'DUPLICATE_ACTIVE_IDENTIFIER';
  end if;

  return new;
end;
$$;

drop trigger if exists products_guard_identifier on public.products;
create trigger products_guard_identifier
before insert or update of serial_number, status on public.products
for each row execute procedure public.guard_active_product_identifier();

-- Status transitions are guarded in the database as a second line of defense.
create or replace function public.guard_product_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  role_name text;
  allowed boolean := false;
begin
  if new.status = old.status then
    return new;
  end if;

  role_name := public.current_user_role();

  allowed := case old.status
    when 'draft' then new.status in ('photo_ready','ready_to_list','repair','consignment','cancelled')
    when 'photo_ready' then new.status in ('draft','ready_to_list','repair','consignment','cancelled')
    when 'ready_to_list' then new.status in ('draft','photo_ready','published','reserved','sold','repair','consignment','cancelled')
    when 'published' then new.status in ('ready_to_list','reserved','sold','repair','cancelled')
    when 'reserved' then new.status in ('ready_to_list','published','sold','cancelled')
    when 'sold' then new.status in ('returned')
    when 'repair' then new.status in ('draft','photo_ready','ready_to_list','consignment','cancelled')
    when 'consignment' then new.status in ('draft','photo_ready','ready_to_list','published','reserved','sold','returned','cancelled')
    when 'returned' then new.status = 'draft' and role_name in ('owner','admin')
    when 'cancelled' then new.status = 'draft' and role_name in ('owner','admin')
    else false
  end;

  if not allowed then
    raise exception 'INVALID_STATUS_TRANSITION:%->%', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists products_guard_status_transition on public.products;
create trigger products_guard_status_transition
before update of status on public.products
for each row execute procedure public.guard_product_status_transition();

-- Helpful index for owner/admin activity history.
create index if not exists activity_logs_product_created_idx
on public.activity_logs(product_id, created_at desc);

-- AMPHON Product Hub + SHOP-6.1 — FULL DATABASE SETUP
-- Generated 2026-09-12
-- Safe path for a fresh Supabase project or an existing AMPHON project.
-- Source migrations are intentionally kept below in their original order.
-- DO NOT append verification/acceptance SQL here; those are read-only post-deploy gates.


-- ============================================================================
-- BEGIN SOURCE: supabase/schema.sql
-- ============================================================================
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

-- ============================================================================
-- END SOURCE: supabase/schema.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/batch3_2.sql
-- ============================================================================
-- AMPHON Product Hub — Batch 3.2 migration
-- Run once in Supabase SQL Editor when upgrading from Batch 2 / 3 / 3.1.
-- Safe to re-run.

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
create index if not exists products_subtype_idx on public.products(subtype);

alter table public.product_images add column if not exists image_role text;
update public.product_images
set image_role = case when is_cover then 'cover' else 'other' end
where image_role is null;

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

-- ============================================================================
-- END SOURCE: supabase/batch3_2.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/batch3_3.sql
-- ============================================================================
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

-- ============================================================================
-- END SOURCE: supabase/batch3_3.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/batch3_4.sql
-- ============================================================================
-- AMPHON Product Hub — Batch 3.4 Employee Management
-- Run once after Batch 3.3. Safe to re-run.

create table if not exists public.employee_activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists employee_activity_logs_created_idx
on public.employee_activity_logs(created_at desc);

create index if not exists employee_activity_logs_target_idx
on public.employee_activity_logs(target_user_id, created_at desc);

alter table public.employee_activity_logs enable row level security;

drop policy if exists employee_logs_read_admin on public.employee_activity_logs;
create policy employee_logs_read_admin on public.employee_activity_logs
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

-- Writes are intentionally server-only through the Cloudflare Worker secret key.
-- No authenticated INSERT/UPDATE/DELETE policy is granted here.

-- Keep employee list fresh across multiple owner/admin devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.profiles;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ============================================================================
-- END SOURCE: supabase/batch3_4.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/batch4.sql
-- ============================================================================
-- AMPHON Product Hub — Batch 4 Publish Center
-- Run once after Batch 3.4. Safe to re-run.

create table if not exists public.product_publications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  channel text not null check (channel in ('facebook','marketplace','winner_it','website')),
  status text not null default 'not_published' check (status in ('not_published','published','ended')),
  external_url text,
  listing_ref text,
  notes text,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  published_by_name text,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  ended_by_name text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, channel)
);

create index if not exists product_publications_product_idx
on public.product_publications(product_id, channel);

create index if not exists product_publications_status_idx
on public.product_publications(status, updated_at desc);

create or replace function public.touch_product_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_publications_touch on public.product_publications;
create trigger product_publications_touch
before update on public.product_publications
for each row execute procedure public.touch_product_publication();

alter table public.product_publications enable row level security;

drop policy if exists publications_read_authenticated on public.product_publications;
drop policy if exists publications_insert_sales on public.product_publications;
drop policy if exists publications_update_sales on public.product_publications;
drop policy if exists publications_delete_admin on public.product_publications;

create policy publications_read_authenticated on public.product_publications
for select to authenticated
using (public.current_user_active());

create policy publications_insert_sales on public.product_publications
for insert to authenticated
with check (
  public.current_user_role() in ('owner','admin','sales')
  and updated_by = auth.uid()
);

create policy publications_update_sales on public.product_publications
for update to authenticated
using (public.current_user_role() in ('owner','admin','sales'))
with check (
  public.current_user_role() in ('owner','admin','sales')
  and updated_by = auth.uid()
);

create policy publications_delete_admin on public.product_publications
for delete to authenticated
using (public.current_user_role() in ('owner','admin'));

-- Multiple phones/tablets see channel status changes without manual refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.product_publications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ============================================================================
-- END SOURCE: supabase/batch4.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/batch4_1.sql
-- ============================================================================
-- AMPHON Product Hub — Batch 4.1 Sales Website Integration
-- Run once after Batch 4. Safe to re-run.

-- Safe public projection used only by the Cloudflare Worker with the server-side secret key.
-- Sensitive fields are intentionally excluded: serial/IMEI, cost, internal notes, employee data.
create or replace view public.website_products as
select
  p.id as product_id,
  p.sku,
  p.category,
  p.subtype,
  p.brand,
  p.model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at,
  pp.published_at,
  pp.updated_at as publication_updated_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
 and pp.status = 'published'
where p.status in ('published', 'reserved')
  and p.price is not null
  and p.price > 0;

-- Keep the view server-only. The public browser never talks to Supabase directly for store data.
revoke all on public.website_products from anon;
revoke all on public.website_products from authenticated;
grant select on public.website_products to service_role;

create index if not exists product_publications_website_live_idx
on public.product_publications(product_id, updated_at desc)
where channel = 'website' and status = 'published';

-- When inventory becomes unavailable, remove it from the sales website automatically.
create or replace function public.auto_end_website_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
  changed_count integer := 0;
begin
  if new.status in ('sold', 'returned', 'cancelled')
     and old.status is distinct from new.status then
    select p.display_name
      into actor_name
      from public.profiles p
      where p.id = new.updated_by
      limit 1;

    update public.product_publications
       set status = 'ended',
           ended_at = now(),
           ended_by = new.updated_by,
           ended_by_name = coalesce(actor_name, 'ระบบ'),
           updated_by = new.updated_by,
           updated_by_name = coalesce(actor_name, 'ระบบ'),
           notes = case
             when coalesce(notes, '') = '' then 'Auto-unpublished: product status changed to ' || new.status
             else notes
           end
     where product_id = new.id
       and channel = 'website'
       and status = 'published';

    get diagnostics changed_count = row_count;

    if changed_count > 0 then
      insert into public.activity_logs(actor_id, product_id, action, metadata)
      values (
        new.updated_by,
        new.id,
        'website_auto_unpublished',
        jsonb_build_object('product_status', new.status, 'count', changed_count)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.auto_end_website_publication() from public;

drop trigger if exists products_auto_end_website_publication on public.products;
create trigger products_auto_end_website_publication
after update of status on public.products
for each row execute procedure public.auto_end_website_publication();

-- ============================================================================
-- END SOURCE: supabase/batch4_1.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_1.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-1 Commerce Foundation
-- Run after supabase/batch4_1.sql
-- Safe to re-run.
--
-- Goals:
-- 1) Keep Product Hub as the inventory source of truth.
-- 2) Add durable SEO/catalog entities without copying private inventory data.
-- 3) Keep the public storefront server-only: anon/authenticated do not read these tables directly.
-- 4) Preserve existing website publication lifecycle from product_publications.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- ENUM-LIKE CHECK VALUES
-- ------------------------------------------------------------

-- SEO index lifecycle is text + check to make future migrations explicit.
-- INDEX   = intended to be indexable
-- NOINDEX = public route may exist, but should not be indexed
-- HOLD    = not ready for SEO release yet
-- RETIRED = no longer an active SEO owner

-- ------------------------------------------------------------
-- EVERGREEN TAXONOMY
-- ------------------------------------------------------------

create table if not exists public.commerce_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_th text not null,
  name_en text,
  slug text not null unique,
  parent_id uuid references public.commerce_categories(id) on delete set null,

  -- Mapping back to Product Hub fields. Multiple SEO categories may share
  -- the same source_category; is_default_source chooses the automatic fallback.
  source_category text,
  source_subtype text,
  source_query text,
  is_default_source boolean not null default false,

  seo_title text,
  seo_description text,
  intro_content text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),

  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_categories_parent_idx
on public.commerce_categories(parent_id, sort_order);

create index if not exists commerce_categories_source_idx
on public.commerce_categories(source_category, source_subtype, is_default_source, sort_order);

create unique index if not exists commerce_categories_one_default_per_source_idx
on public.commerce_categories(source_category)
where is_default_source = true and source_category is not null;

create table if not exists public.commerce_brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  seo_title text,
  seo_description text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists commerce_brands_name_ci_uidx
on public.commerce_brands(lower(name));

create table if not exists public.commerce_series (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete restrict,
  brand_id uuid not null references public.commerce_brands(id) on delete restrict,
  name text not null,
  slug text not null,
  seo_title text,
  seo_description text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id, slug),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_series_brand_idx
on public.commerce_series(category_id, brand_id, is_active);

create table if not exists public.commerce_models (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete restrict,
  brand_id uuid not null references public.commerce_brands(id) on delete restrict,
  series_id uuid references public.commerce_series(id) on delete set null,

  model_name text not null,
  model_code text,
  slug text not null,
  launch_year integer,
  generation text,
  canonical_specs jsonb not null default '{}'::jsonb,

  seo_title text,
  seo_description text,
  seo_content text,
  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id, slug),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_models_series_idx
on public.commerce_models(category_id, brand_id, series_id, is_active);

-- ------------------------------------------------------------
-- PRODUCT -> STOREFRONT LISTING METADATA
-- ------------------------------------------------------------
-- Price/specs/condition/images/status remain on Product Hub tables.
-- This table owns only stable public URL + SEO/catalog relationships.

create table if not exists public.commerce_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,

  category_id uuid references public.commerce_categories(id) on delete set null,
  brand_id uuid references public.commerce_brands(id) on delete set null,
  series_id uuid references public.commerce_series(id) on delete set null,
  model_id uuid references public.commerce_models(id) on delete set null,

  -- Immutable once generated. Canonical URL is /p/{slug}-{sku-lower}/
  slug text not null,

  seo_title text,
  seo_description text,
  index_policy text not null default 'INDEX'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),

  merchant_enabled boolean not null default false,
  google_product_category text,
  gtin text,
  mpn text,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists commerce_listings_category_idx
on public.commerce_listings(category_id, updated_at desc);

create index if not exists commerce_listings_model_idx
on public.commerce_listings(model_id, updated_at desc);

create index if not exists commerce_listings_index_policy_idx
on public.commerce_listings(index_policy, updated_at desc);

-- ------------------------------------------------------------
-- INTERNAL HELPERS
-- ------------------------------------------------------------

create or replace function private.commerce_slug_base(input_title text, input_sku text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from lower(
        regexp_replace(
          regexp_replace(coalesce(input_title, ''), '[^A-Za-z0-9]+', '-', 'g'),
          '-+', '-', 'g'
        )
      )),
      ''
    ),
    'item'
  );
$$;

revoke all on function private.commerce_slug_base(text, text) from public;
revoke all on function private.commerce_slug_base(text, text) from anon;
revoke all on function private.commerce_slug_base(text, text) from authenticated;

create or replace function private.touch_commerce_row()
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

revoke all on function private.touch_commerce_row() from public;
revoke all on function private.touch_commerce_row() from anon;
revoke all on function private.touch_commerce_row() from authenticated;

drop trigger if exists commerce_categories_touch on public.commerce_categories;
create trigger commerce_categories_touch
before update on public.commerce_categories
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_brands_touch on public.commerce_brands;
create trigger commerce_brands_touch
before update on public.commerce_brands
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_series_touch on public.commerce_series;
create trigger commerce_series_touch
before update on public.commerce_series
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_models_touch on public.commerce_models;
create trigger commerce_models_touch
before update on public.commerce_models
for each row execute procedure private.touch_commerce_row();

drop trigger if exists commerce_listings_touch on public.commerce_listings;
create trigger commerce_listings_touch
before update on public.commerce_listings
for each row execute procedure private.touch_commerce_row();

-- Automatically create storefront metadata the first time Website is published.
-- Existing slug is NEVER rewritten on later product-title edits.
create or replace function private.ensure_commerce_listing_for_website()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_row public.products%rowtype;
  mapped_category_id uuid;
begin
  if new.channel <> 'website' or new.status <> 'published' then
    return new;
  end if;

  select *
    into product_row
    from public.products
   where id = new.product_id;

  if product_row.id is null then
    return new;
  end if;

  select c.id
    into mapped_category_id
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = product_row.category
     and (
       c.source_subtype = product_row.subtype
       or c.source_subtype is null
     )
   order by
     (c.source_subtype is not null) desc,
     c.is_default_source desc,
     c.sort_order asc
   limit 1;

  insert into public.commerce_listings (
    product_id,
    category_id,
    slug,
    seo_title,
    seo_description,
    index_policy,
    published_at
  )
  values (
    product_row.id,
    mapped_category_id,
    private.commerce_slug_base(product_row.title, product_row.sku),
    left(product_row.title || ' มือสอง | AMPHON TRADING', 180),
    left(
      concat_ws(
        ' ',
        product_row.title,
        case when product_row.brand is not null then 'แบรนด์ ' || product_row.brand end,
        'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'
      ),
      300
    ),
    'INDEX',
    coalesce(new.published_at, now())
  )
  on conflict (product_id) do update
    set category_id = coalesce(public.commerce_listings.category_id, excluded.category_id),
        published_at = coalesce(public.commerce_listings.published_at, excluded.published_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function private.ensure_commerce_listing_for_website() from public;
revoke all on function private.ensure_commerce_listing_for_website() from anon;
revoke all on function private.ensure_commerce_listing_for_website() from authenticated;

drop trigger if exists product_publications_ensure_commerce_listing on public.product_publications;
create trigger product_publications_ensure_commerce_listing
after insert or update of status, published_at on public.product_publications
for each row execute procedure private.ensure_commerce_listing_for_website();

-- Backfill listings for Website publications already live.
insert into public.commerce_listings (
  product_id,
  category_id,
  slug,
  seo_title,
  seo_description,
  index_policy,
  published_at
)
select
  p.id,
  (
    select c.id
      from public.commerce_categories c
     where c.is_active = true
       and c.source_category = p.category
       and (c.source_subtype = p.subtype or c.source_subtype is null)
     order by
       (c.source_subtype is not null) desc,
       c.is_default_source desc,
       c.sort_order asc
     limit 1
  ),
  private.commerce_slug_base(p.title, p.sku),
  left(p.title || ' มือสอง | AMPHON TRADING', 180),
  left(
    concat_ws(
      ' ',
      p.title,
      case when p.brand is not null then 'แบรนด์ ' || p.brand end,
      'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'
    ),
    300
  ),
  'INDEX',
  coalesce(pp.published_at, now())
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
 and (
   pp.status = 'published'
   or (pp.status = 'ended' and p.status = 'sold')
 )
on conflict (product_id) do nothing;

-- ------------------------------------------------------------
-- RLS / GRANTS
-- ------------------------------------------------------------

alter table public.commerce_categories enable row level security;
alter table public.commerce_brands enable row level security;
alter table public.commerce_series enable row level security;
alter table public.commerce_models enable row level security;
alter table public.commerce_listings enable row level security;

-- Storefront browser must never query these directly.
revoke all on public.commerce_categories from anon;
revoke all on public.commerce_brands from anon;
revoke all on public.commerce_series from anon;
revoke all on public.commerce_models from anon;
revoke all on public.commerce_listings from anon;

-- Staff can read taxonomy/listing metadata from Product Hub in future batches.
grant select on public.commerce_categories to authenticated;
grant select on public.commerce_brands to authenticated;
grant select on public.commerce_series to authenticated;
grant select on public.commerce_models to authenticated;
grant select on public.commerce_listings to authenticated;

-- Owner/Admin manage taxonomy; Owner/Admin/Sales may maintain listing metadata.
grant insert, update, delete on public.commerce_categories to authenticated;
grant insert, update, delete on public.commerce_brands to authenticated;
grant insert, update, delete on public.commerce_series to authenticated;
grant insert, update, delete on public.commerce_models to authenticated;
grant insert, update on public.commerce_listings to authenticated;

drop policy if exists commerce_categories_read_staff on public.commerce_categories;
drop policy if exists commerce_categories_write_admin on public.commerce_categories;
drop policy if exists commerce_brands_read_staff on public.commerce_brands;
drop policy if exists commerce_brands_write_admin on public.commerce_brands;
drop policy if exists commerce_series_read_staff on public.commerce_series;
drop policy if exists commerce_series_write_admin on public.commerce_series;
drop policy if exists commerce_models_read_staff on public.commerce_models;
drop policy if exists commerce_models_write_admin on public.commerce_models;
drop policy if exists commerce_listings_read_staff on public.commerce_listings;
drop policy if exists commerce_listings_insert_sales on public.commerce_listings;
drop policy if exists commerce_listings_update_sales on public.commerce_listings;

create policy commerce_categories_read_staff
on public.commerce_categories for select to authenticated
using (public.current_user_active());

create policy commerce_categories_write_admin
on public.commerce_categories for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_brands_read_staff
on public.commerce_brands for select to authenticated
using (public.current_user_active());

create policy commerce_brands_write_admin
on public.commerce_brands for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_series_read_staff
on public.commerce_series for select to authenticated
using (public.current_user_active());

create policy commerce_series_write_admin
on public.commerce_series for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_models_read_staff
on public.commerce_models for select to authenticated
using (public.current_user_active());

create policy commerce_models_write_admin
on public.commerce_models for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_listings_read_staff
on public.commerce_listings for select to authenticated
using (public.current_user_active());

create policy commerce_listings_insert_sales
on public.commerce_listings for insert to authenticated
with check (public.current_user_role() in ('owner','admin','sales'));

create policy commerce_listings_update_sales
on public.commerce_listings for update to authenticated
using (public.current_user_role() in ('owner','admin','sales'))
with check (public.current_user_role() in ('owner','admin','sales'));

-- ------------------------------------------------------------
-- SAFE SERVER-ONLY PROJECTION
-- ------------------------------------------------------------
-- security_invoker protects the view if grants are ever changed accidentally.
-- service_role still sees all intended rows; anon/authenticated are explicitly revoked.

create or replace view public.commerce_public_listing_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.category as source_category,
  p.subtype as source_subtype,
  p.brand as source_brand,
  p.model as source_model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at as product_updated_at,

  cl.slug,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,

  c.key as category_key,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  c.slug as category_slug,

  b.name as catalog_brand_name,
  b.slug as catalog_brand_slug,

  s.name as series_name,
  s.slug as series_slug,

  m.model_name as catalog_model_name,
  m.model_code as catalog_model_code,
  m.slug as catalog_model_slug,

  pp.published_at,
  pp.updated_at as publication_updated_at,

  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order,
          'width', pi.width,
          'height', pi.height
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
left join public.commerce_listings cl
  on cl.product_id = p.id
left join public.commerce_categories c
  on c.id = cl.category_id
left join public.commerce_brands b
  on b.id = cl.brand_id
left join public.commerce_series s
  on s.id = cl.series_id
left join public.commerce_models m
  on m.id = cl.model_id
where cl.id is not null
  and (
    (pp.status = 'published' and p.status in ('published','reserved'))
    or (pp.status = 'ended' and p.status = 'sold')
  )
  and p.price is not null
  and p.price > 0;

revoke all on public.commerce_public_listing_v from anon;
revoke all on public.commerce_public_listing_v from authenticated;
grant select on public.commerce_public_listing_v to service_role;

-- ------------------------------------------------------------
-- CATEGORY SEED — SHOP-0 BASELINE
-- ------------------------------------------------------------

insert into public.commerce_categories (
  key, name_th, name_en, slug,
  source_category, source_subtype, source_query, is_default_source,
  seo_title, seo_description, index_policy, sort_order, is_active
)
values
  (
    'notebooks', 'โน้ตบุ๊กมือสอง', 'Used Notebooks', 'notebooks',
    'notebook', null, null, true,
    'โน้ตบุ๊กมือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อโน้ตบุ๊กมือสองจาก AMPHON TRADING ดูรูป สเปก ราคา สภาพและประกันของสินค้าจริงก่อนสั่งซื้อ',
    'INDEX', 10, true
  ),
  (
    'macbooks', 'MacBook มือสอง', 'Used MacBooks', 'macbooks',
    'notebook', null, 'MacBook', false,
    'MacBook มือสอง สภาพจริง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อ MacBook มือสอง ดูรูปจริง สเปก ราคา สภาพและประกันจาก AMPHON TRADING',
    'HOLD', 20, true
  ),
  (
    'desktop-pcs', 'คอมพิวเตอร์มือสอง', 'Used Desktop PCs', 'desktop-pcs',
    'pc', null, null, true,
    'คอมพิวเตอร์มือสอง พร้อมใช้งาน | AMPHON TRADING',
    'คอมพิวเตอร์ตั้งโต๊ะมือสองและชุด PC พร้อมดูสเปก ราคา รูปจริงและสถานะสินค้าก่อนสั่งซื้อ',
    'INDEX', 30, true
  ),
  (
    'gaming-pcs', 'คอมเกมมิ่งมือสอง', 'Used Gaming PCs', 'gaming-pcs',
    'pc', 'gaming', null, false,
    'คอมเกมมิ่งมือสอง สเปกคุ้ม | AMPHON TRADING',
    'เลือกซื้อ PC Gaming มือสอง ดู CPU การ์ดจอ RAM SSD ราคาและรูปสินค้าจริง',
    'HOLD', 40, true
  ),
  (
    'iphones', 'iPhone มือสอง', 'Used iPhones', 'iphones',
    'iphone', null, null, true,
    'iPhone มือสอง ดูเครื่องจริงและราคา | AMPHON TRADING',
    'เลือกซื้อ iPhone มือสอง ดูรุ่น ความจุ สภาพ ราคา รูปสินค้าจริงและรายละเอียดก่อนซื้อ',
    'INDEX', 50, true
  ),
  (
    'smartphones', 'มือถือมือสอง', 'Used Smartphones', 'smartphones',
    'smartphone', null, null, true,
    'มือถือมือสอง Android พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อมือถือ Android มือสองจากสินค้าจริง พร้อมสเปก ราคา สภาพและรูปประกอบ',
    'INDEX', 60, true
  ),
  (
    'tablets', 'iPad และ Tablet มือสอง', 'Used Tablets', 'tablets',
    'tablet', null, null, true,
    'iPad และ Tablet มือสอง | AMPHON TRADING',
    'เลือกซื้อ iPad และ Tablet มือสอง ดูรุ่น ความจุ สภาพ ราคาและรูปสินค้าจริง',
    'INDEX', 70, true
  ),
  (
    'monitors', 'จอคอมมือสอง', 'Used Monitors', 'monitors',
    'monitor', null, null, true,
    'จอคอมมือสอง พร้อมราคา | AMPHON TRADING',
    'เลือกซื้อจอคอมมือสอง ดูขนาด ความละเอียด รีเฟรชเรต ราคาและรูปสินค้าจริง',
    'INDEX', 80, true
  ),
  (
    'cameras', 'กล้องมือสอง', 'Used Cameras', 'cameras',
    'camera', null, null, true,
    'กล้องมือสอง Mirrorless DSLR | AMPHON TRADING',
    'เลือกซื้อกล้องมือสอง ดูบอดี้ เลนส์ สภาพ ราคาและรูปสินค้าจริงจาก AMPHON TRADING',
    'INDEX', 90, true
  ),
  (
    'gaming-consoles', 'เครื่องเกมมือสอง', 'Used Game Consoles', 'gaming-consoles',
    'gaming', null, null, true,
    'เครื่องเกมมือสอง PS5 Nintendo Switch | AMPHON TRADING',
    'เลือกซื้อเครื่องเกมมือสอง ดูรุ่น อุปกรณ์ สภาพ ราคาและรูปสินค้าจริง',
    'INDEX', 100, true
  ),
  (
    'camera-lenses', 'เลนส์กล้องมือสอง', 'Used Camera Lenses', 'camera-lenses',
    'lens', null, null, true,
    'เลนส์กล้องมือสอง | AMPHON TRADING',
    'เลือกซื้อเลนส์กล้องมือสอง ดูรุ่น เมาท์ สภาพ ราคาและรูปสินค้าจริง',
    'HOLD', 105, true
  ),
  (
    'graphics-cards', 'การ์ดจอมือสอง', 'Used Graphics Cards', 'graphics-cards',
    'component', null, null, false,
    'การ์ดจอมือสอง NVIDIA AMD | AMPHON TRADING',
    'รวมการ์ดจอมือสองสำหรับคอมพิวเตอร์และเกมมิ่ง พร้อมดูรุ่น ราคาและสภาพจริง',
    'HOLD', 110, true
  ),
  (
    'pc-components', 'อุปกรณ์คอมมือสอง', 'Used PC Components', 'pc-components',
    'component', null, null, true,
    'อุปกรณ์คอมมือสอง | AMPHON TRADING',
    'เลือกซื้ออุปกรณ์คอมพิวเตอร์มือสองจากสินค้าจริง พร้อมราคา สเปกและสภาพสินค้า',
    'HOLD', 120, true
  ),
  (
    'accessories', 'อุปกรณ์ไอทีมือสอง', 'Used IT Accessories', 'accessories',
    'accessory', null, null, true,
    'อุปกรณ์ไอทีมือสอง | AMPHON TRADING',
    'รวมอุปกรณ์ไอทีมือสองจากสินค้าจริง พร้อมราคาและรายละเอียดก่อนสั่งซื้อ',
    'HOLD', 130, true
  ),
  (
    'other-it', 'สินค้าไอทีมือสองอื่น ๆ', 'Other Used IT', 'other-it',
    'other', null, null, true,
    'สินค้าไอทีมือสองอื่น ๆ | AMPHON TRADING',
    'สินค้าไอทีมือสองประเภทอื่นจากสต๊อกจริงของ AMPHON TRADING',
    'HOLD', 140, true
  )
on conflict (key) do update
set
  name_th = excluded.name_th,
  name_en = excluded.name_en,
  slug = excluded.slug,
  source_category = excluded.source_category,
  source_subtype = excluded.source_subtype,
  source_query = excluded.source_query,
  is_default_source = excluded.is_default_source,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  index_policy = excluded.index_policy,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

-- Backfill category_id again after seed for any listing created earlier in this migration.
-- Keep this as a correlated subquery so it is valid across supported PostgreSQL versions.
update public.commerce_listings cl
set category_id = (
      select c.id
      from public.products p
      join public.commerce_categories c
        on c.is_active = true
       and c.source_category = p.category
       and (c.source_subtype = p.subtype or c.source_subtype is null)
      where p.id = cl.product_id
      order by
        (c.source_subtype is not null) desc,
        c.is_default_source desc,
        c.sort_order asc
      limit 1
    ),
    updated_at = now()
where cl.category_id is null;

-- ============================================================================
-- END SOURCE: supabase/shop_1.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_2.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-2 Brand / Series / Model Evergreen SEO Architecture
-- Run after supabase/shop_1.sql
-- Safe to re-run.
--
-- Principles:
-- 1) Brand identity is global, but Brand SEO pages are category-specific.
-- 2) Series and Model pages are curated evergreen assets, never auto-indexed from raw product text.
-- 3) Raw stock fields may create HOLD taxonomy candidates, but INDEX remains an explicit editorial decision.
-- 4) Product listing mappings are deterministic and exact/alias-based; no fuzzy SEO taxonomy assignment.
-- 5) Public storefront reads only server-side views through the Store API.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- CONTENT FIELDS FOR EVERGREEN ENTITIES
-- ------------------------------------------------------------

alter table public.commerce_brands add column if not exists sort_order integer not null default 100;

alter table public.commerce_series add column if not exists seo_h1 text;
alter table public.commerce_series add column if not exists intro_content text;
alter table public.commerce_series add column if not exists editorial_content text;
alter table public.commerce_series add column if not exists faq jsonb not null default '[]'::jsonb;
alter table public.commerce_series add column if not exists primary_keyword text;
alter table public.commerce_series add column if not exists sort_order integer not null default 100;

alter table public.commerce_models add column if not exists seo_h1 text;
alter table public.commerce_models add column if not exists intro_content text;
alter table public.commerce_models add column if not exists faq jsonb not null default '[]'::jsonb;
alter table public.commerce_models add column if not exists primary_keyword text;
alter table public.commerce_models add column if not exists sort_order integer not null default 100;

-- SHOP-1 kept SEO fields on commerce_brands. Those columns remain for backward
-- compatibility, but category-specific SEO ownership moves to commerce_brand_pages.
create table if not exists public.commerce_brand_pages (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.commerce_categories(id) on delete cascade,
  brand_id uuid not null references public.commerce_brands(id) on delete cascade,

  seo_title text,
  seo_description text,
  seo_h1 text,
  primary_keyword text,
  intro_content text,
  editorial_content text,
  faq jsonb not null default '[]'::jsonb,

  index_policy text not null default 'HOLD'
    check (index_policy in ('INDEX','NOINDEX','HOLD','RETIRED')),
  sort_order integer not null default 100,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(category_id, brand_id)
);

create index if not exists commerce_brand_pages_category_idx
on public.commerce_brand_pages(category_id, index_policy, sort_order);

-- Explicit aliases allow Product Hub labels to map to canonical identities
-- without risky fuzzy matching. Example: "Hewlett Packard" -> HP.
create table if not exists public.commerce_brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.commerce_brands(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists commerce_brand_aliases_alias_ci_uidx
on public.commerce_brand_aliases(lower(alias));

create table if not exists public.commerce_model_aliases (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.commerce_models(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique(model_id, alias)
);

create unique index if not exists commerce_model_aliases_model_alias_ci_uidx
on public.commerce_model_aliases(model_id, lower(alias));

create index if not exists commerce_model_aliases_lookup_idx
on public.commerce_model_aliases(lower(alias));

-- ------------------------------------------------------------
-- TOUCH TRIGGERS
-- ------------------------------------------------------------

drop trigger if exists commerce_brand_pages_touch on public.commerce_brand_pages;
create trigger commerce_brand_pages_touch
before update on public.commerce_brand_pages
for each row execute procedure private.touch_commerce_row();

-- ------------------------------------------------------------
-- SAFE ASCII SLUG + BRAND BOOTSTRAP
-- ------------------------------------------------------------

create or replace function private.commerce_ascii_slug(input_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from lower(
        regexp_replace(
          regexp_replace(coalesce(input_value, ''), '[^A-Za-z0-9]+', '-', 'g'),
          '-+', '-', 'g'
        )
      )),
      ''
    ),
    'item'
  );
$$;

revoke all on function private.commerce_ascii_slug(text) from public;
revoke all on function private.commerce_ascii_slug(text) from anon;
revoke all on function private.commerce_ascii_slug(text) from authenticated;

create or replace function private.ensure_commerce_brand(input_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := nullif(trim(input_name), '');
  found_id uuid;
  base_slug text;
  chosen_slug text;
begin
  if cleaned is null then
    return null;
  end if;

  select b.id into found_id
    from public.commerce_brands b
   where lower(b.name) = lower(cleaned)
      or exists (
        select 1 from public.commerce_brand_aliases ba
         where ba.brand_id = b.id and lower(ba.alias) = lower(cleaned)
      )
   order by (lower(b.name) = lower(cleaned)) desc
   limit 1;

  if found_id is not null then
    return found_id;
  end if;

  base_slug := private.commerce_ascii_slug(cleaned);
  chosen_slug := base_slug;

  if exists (select 1 from public.commerce_brands b where b.slug = chosen_slug) then
    chosen_slug := base_slug || '-' || substr(md5(lower(cleaned)), 1, 6);
  end if;

  insert into public.commerce_brands(name, slug, index_policy)
  values (cleaned, chosen_slug, 'HOLD')
  on conflict do nothing
  returning id into found_id;

  if found_id is null then
    select b.id into found_id
      from public.commerce_brands b
     where lower(b.name) = lower(cleaned)
     limit 1;
  end if;

  return found_id;
end;
$$;

revoke all on function private.ensure_commerce_brand(text) from public;
revoke all on function private.ensure_commerce_brand(text) from anon;
revoke all on function private.ensure_commerce_brand(text) from authenticated;

-- ------------------------------------------------------------
-- DETERMINISTIC PRODUCT -> TAXONOMY MAPPING
-- ------------------------------------------------------------

create or replace function private.sync_commerce_listing_taxonomy(target_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  cl public.commerce_listings%rowtype;
  resolved_category uuid;
  resolved_brand uuid;
  resolved_model uuid;
  resolved_series uuid;
begin
  select * into p from public.products where id = target_product_id;
  if p.id is null then return; end if;

  select * into cl from public.commerce_listings where product_id = target_product_id;
  if cl.id is null then return; end if;

  select c.id into resolved_category
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = p.category
     and (c.source_subtype = p.subtype or c.source_subtype is null)
   order by (c.source_subtype is not null) desc, c.is_default_source desc, c.sort_order asc
   limit 1;

  resolved_category := coalesce(resolved_category, cl.category_id);
  resolved_brand := private.ensure_commerce_brand(p.brand);

  if resolved_category is not null and resolved_brand is not null then
    insert into public.commerce_brand_pages(category_id, brand_id, index_policy)
    values (resolved_category, resolved_brand, 'HOLD')
    on conflict (category_id, brand_id) do nothing;
  end if;

  if resolved_category is not null and resolved_brand is not null and nullif(trim(p.model), '') is not null then
    select m.id, m.series_id
      into resolved_model, resolved_series
      from public.commerce_models m
     where m.is_active = true
       and m.category_id = resolved_category
       and m.brand_id = resolved_brand
       and (
         lower(m.model_name) = lower(trim(p.model))
         or (m.model_code is not null and lower(m.model_code) = lower(trim(p.model)))
         or exists (
           select 1 from public.commerce_model_aliases ma
            where ma.model_id = m.id and lower(ma.alias) = lower(trim(p.model))
         )
       )
     order by
       (lower(m.model_name) = lower(trim(p.model))) desc,
       (m.model_code is not null and lower(m.model_code) = lower(trim(p.model))) desc,
       m.updated_at desc
     limit 1;
  end if;

  -- Keep a manually assigned series only when it still belongs to the resolved
  -- category + brand. A resolved model always owns the series relationship.
  if resolved_model is null and cl.series_id is not null and exists (
    select 1 from public.commerce_series s
     where s.id = cl.series_id
       and s.category_id = resolved_category
       and s.brand_id = resolved_brand
       and s.is_active = true
  ) then
    resolved_series := cl.series_id;
  end if;

  update public.commerce_listings
     set category_id = resolved_category,
         brand_id = resolved_brand,
         series_id = resolved_series,
         model_id = resolved_model,
         updated_at = now()
   where product_id = target_product_id;
end;
$$;

revoke all on function private.sync_commerce_listing_taxonomy(uuid) from public;
revoke all on function private.sync_commerce_listing_taxonomy(uuid) from anon;
revoke all on function private.sync_commerce_listing_taxonomy(uuid) from authenticated;

create or replace function private.product_sync_commerce_taxonomy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_commerce_listing_taxonomy(new.id);
  return new;
end;
$$;

revoke all on function private.product_sync_commerce_taxonomy_trigger() from public;
revoke all on function private.product_sync_commerce_taxonomy_trigger() from anon;
revoke all on function private.product_sync_commerce_taxonomy_trigger() from authenticated;

drop trigger if exists products_sync_commerce_taxonomy on public.products;
create trigger products_sync_commerce_taxonomy
after update of category, subtype, brand, model on public.products
for each row execute procedure private.product_sync_commerce_taxonomy_trigger();

create or replace function private.listing_sync_commerce_taxonomy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_commerce_listing_taxonomy(new.product_id);
  return new;
end;
$$;

revoke all on function private.listing_sync_commerce_taxonomy_trigger() from public;
revoke all on function private.listing_sync_commerce_taxonomy_trigger() from anon;
revoke all on function private.listing_sync_commerce_taxonomy_trigger() from authenticated;

drop trigger if exists commerce_listings_sync_taxonomy_after_insert on public.commerce_listings;
create trigger commerce_listings_sync_taxonomy_after_insert
after insert on public.commerce_listings
for each row execute procedure private.listing_sync_commerce_taxonomy_trigger();

-- Admin RPC for remapping after creating/editing Series, Models or aliases.
create or replace function public.refresh_commerce_taxonomy_mappings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  affected integer := 0;
begin
  if public.current_user_role() not in ('owner','admin') then
    raise exception 'FORBIDDEN';
  end if;

  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
    affected := affected + 1;
  end loop;

  return affected;
end;
$$;

revoke all on function public.refresh_commerce_taxonomy_mappings() from public;
revoke all on function public.refresh_commerce_taxonomy_mappings() from anon;
grant execute on function public.refresh_commerce_taxonomy_mappings() to authenticated;

-- Bootstrap and map every listing that already existed before SHOP-2.
do $$
declare
  item record;
begin
  for item in select product_id from public.commerce_listings loop
    perform private.sync_commerce_listing_taxonomy(item.product_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- RLS / GRANTS FOR NEW TABLES
-- ------------------------------------------------------------

alter table public.commerce_brand_pages enable row level security;
alter table public.commerce_brand_aliases enable row level security;
alter table public.commerce_model_aliases enable row level security;

revoke all on public.commerce_brand_pages from anon;
revoke all on public.commerce_brand_aliases from anon;
revoke all on public.commerce_model_aliases from anon;

grant select, insert, update, delete on public.commerce_brand_pages to authenticated;
grant select, insert, update, delete on public.commerce_brand_aliases to authenticated;
grant select, insert, update, delete on public.commerce_model_aliases to authenticated;

drop policy if exists commerce_brand_pages_read_staff on public.commerce_brand_pages;
drop policy if exists commerce_brand_pages_write_admin on public.commerce_brand_pages;
drop policy if exists commerce_brand_aliases_read_staff on public.commerce_brand_aliases;
drop policy if exists commerce_brand_aliases_write_admin on public.commerce_brand_aliases;
drop policy if exists commerce_model_aliases_read_staff on public.commerce_model_aliases;
drop policy if exists commerce_model_aliases_write_admin on public.commerce_model_aliases;

create policy commerce_brand_pages_read_staff
on public.commerce_brand_pages for select to authenticated
using (public.current_user_active());

create policy commerce_brand_pages_write_admin
on public.commerce_brand_pages for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_brand_aliases_read_staff
on public.commerce_brand_aliases for select to authenticated
using (public.current_user_active());

create policy commerce_brand_aliases_write_admin
on public.commerce_brand_aliases for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

create policy commerce_model_aliases_read_staff
on public.commerce_model_aliases for select to authenticated
using (public.current_user_active());

create policy commerce_model_aliases_write_admin
on public.commerce_model_aliases for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- EVERGREEN SEO SERVER-ONLY VIEW
-- ------------------------------------------------------------
-- Effective INDEX requires both editorial readiness and valid hierarchy.
-- HOLD/NOINDEX entities can exist in the database without becoming crawl targets.

create or replace view public.commerce_evergreen_page_v
with (security_invoker = true)
as
with listing_state as (
  select
    cl.category_id,
    cl.brand_id,
    cl.series_id,
    cl.model_id,
    p.id as product_id,
    p.status,
    pp.status as publication_status,
    (pp.status = 'published' and p.status in ('published','reserved')) as is_current
  from public.commerce_listings cl
  join public.products p on p.id = cl.product_id
  join public.product_publications pp
    on pp.product_id = p.id and pp.channel = 'website'
),
brand_rows as (
  select
    'BRAND'::text as page_type,
    bp.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    null::uuid as series_id,
    null::text as series_name,
    null::text as series_slug,
    null::uuid as model_id,
    null::text as model_name,
    null::text as model_code,
    null::text as model_slug,
    bp.seo_title,
    bp.seo_description,
    bp.seo_h1,
    bp.primary_keyword,
    bp.intro_content,
    bp.editorial_content,
    bp.faq,
    bp.index_policy,
    bp.is_active,
    bp.sort_order,
    '/' || c.slug || '/' || b.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.category_id = c.id and ls.brand_id = b.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.category_id = c.id and ls.brand_id = b.id) as historical_listing_count,
    bp.updated_at
  from public.commerce_brand_pages bp
  join public.commerce_categories c on c.id = bp.category_id and c.is_active = true
  join public.commerce_brands b on b.id = bp.brand_id and b.is_active = true
),
series_rows as (
  select
    'SERIES'::text as page_type,
    s.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    s.id as series_id,
    s.name as series_name,
    s.slug as series_slug,
    null::uuid as model_id,
    null::text as model_name,
    null::text as model_code,
    null::text as model_slug,
    s.seo_title,
    s.seo_description,
    s.seo_h1,
    s.primary_keyword,
    s.intro_content,
    s.editorial_content,
    s.faq,
    s.index_policy,
    s.is_active,
    s.sort_order,
    '/' || c.slug || '/' || b.slug || '/' || s.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.series_id = s.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.series_id = s.id) as historical_listing_count,
    s.updated_at
  from public.commerce_series s
  join public.commerce_categories c on c.id = s.category_id and c.is_active = true
  join public.commerce_brands b on b.id = s.brand_id and b.is_active = true
  join public.commerce_brand_pages bp
    on bp.category_id = s.category_id and bp.brand_id = s.brand_id and bp.is_active = true
),
model_rows as (
  select
    'MODEL'::text as page_type,
    m.id as entity_id,
    c.id as category_id,
    c.key as category_key,
    c.name_th as category_name,
    c.slug as category_slug,
    c.index_policy as category_index_policy,
    b.id as brand_id,
    b.name as brand_name,
    b.slug as brand_slug,
    s.id as series_id,
    s.name as series_name,
    s.slug as series_slug,
    m.id as model_id,
    m.model_name,
    m.model_code,
    m.slug as model_slug,
    m.seo_title,
    m.seo_description,
    m.seo_h1,
    m.primary_keyword,
    m.intro_content,
    m.seo_content as editorial_content,
    m.faq,
    m.index_policy,
    m.is_active,
    m.sort_order,
    '/' || c.slug || '/' || b.slug || '/' || s.slug || '/' || m.slug || '/' as canonical_path,
    (select count(*)::int from listing_state ls where ls.model_id = m.id and ls.is_current) as current_stock_count,
    (select count(*)::int from listing_state ls where ls.model_id = m.id) as historical_listing_count,
    m.updated_at
  from public.commerce_models m
  join public.commerce_categories c on c.id = m.category_id and c.is_active = true
  join public.commerce_brands b on b.id = m.brand_id and b.is_active = true
  join public.commerce_series s on s.id = m.series_id and s.is_active = true
  join public.commerce_brand_pages bp
    on bp.category_id = m.category_id and bp.brand_id = m.brand_id and bp.is_active = true
),
all_rows as (
  select * from brand_rows
  union all
  select * from series_rows
  union all
  select * from model_rows
),
readiness as (
  select
    r.*,
    (
      r.is_active
      and r.category_index_policy = 'INDEX'
      and r.index_policy = 'INDEX'
      and nullif(trim(r.seo_title), '') is not null
      and char_length(trim(r.seo_title)) between 20 and 180
      and nullif(trim(r.seo_description), '') is not null
      and char_length(trim(r.seo_description)) between 60 and 320
      and nullif(trim(r.seo_h1), '') is not null
      and coalesce(char_length(trim(r.intro_content)), 0) >= 120
      and r.historical_listing_count >= 1
      and (
        r.current_stock_count > 0
        or coalesce(char_length(trim(r.editorial_content)), 0) >= 400
      )
    ) as base_seo_ready
  from all_rows r
)
select
  r.*,
  case
    when r.page_type = 'BRAND' then r.base_seo_ready
    when r.page_type = 'SERIES' then r.base_seo_ready and exists (
      select 1 from readiness parent
       where parent.page_type = 'BRAND'
         and parent.category_id = r.category_id
         and parent.brand_id = r.brand_id
         and parent.base_seo_ready
    )
    when r.page_type = 'MODEL' then r.base_seo_ready and exists (
      select 1 from readiness parent
       where parent.page_type = 'SERIES'
         and parent.series_id = r.series_id
         and parent.base_seo_ready
    ) and exists (
      select 1 from readiness parent
       where parent.page_type = 'BRAND'
         and parent.category_id = r.category_id
         and parent.brand_id = r.brand_id
         and parent.base_seo_ready
    )
    else false
  end as seo_ready,
  case
    when r.index_policy = 'NOINDEX' then 'NOINDEX'
    when r.index_policy = 'RETIRED' then 'RETIRED'
    when (
      case
        when r.page_type = 'BRAND' then r.base_seo_ready
        when r.page_type = 'SERIES' then r.base_seo_ready and exists (
          select 1 from readiness parent
           where parent.page_type = 'BRAND'
             and parent.category_id = r.category_id
             and parent.brand_id = r.brand_id
             and parent.base_seo_ready
        )
        when r.page_type = 'MODEL' then r.base_seo_ready and exists (
          select 1 from readiness parent
           where parent.page_type = 'SERIES'
             and parent.series_id = r.series_id
             and parent.base_seo_ready
        ) and exists (
          select 1 from readiness parent
           where parent.page_type = 'BRAND'
             and parent.category_id = r.category_id
             and parent.brand_id = r.brand_id
             and parent.base_seo_ready
        )
        else false
      end
    ) then 'INDEX'
    else 'HOLD'
  end as effective_index_policy
from readiness r;

revoke all on public.commerce_evergreen_page_v from anon;
revoke all on public.commerce_evergreen_page_v from authenticated;
grant select on public.commerce_evergreen_page_v to service_role;

-- ------------------------------------------------------------
-- STAFF CANDIDATE VIEW
-- ------------------------------------------------------------
-- Shows raw brand/model labels seen in real published history that have not yet
-- been mapped to a curated model. It is intentionally NOT public storefront data.

create or replace view public.commerce_taxonomy_candidates_v
with (security_invoker = true)
as
select
  c.id as category_id,
  c.key as category_key,
  c.slug as category_slug,
  p.brand as source_brand,
  p.model as source_model,
  count(*)::int as historical_listing_count,
  count(*) filter (where pp.status = 'published' and p.status in ('published','reserved'))::int as current_stock_count,
  max(p.updated_at) as last_seen_at,
  case when count(distinct cl.brand_id) = 1
       then max(cl.brand_id::text)::uuid
       else null
  end as mapped_brand_id,
  case when count(distinct cl.model_id) = 1
       then max(cl.model_id::text)::uuid
       else null
  end as mapped_model_id
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
left join public.commerce_categories c on c.id = cl.category_id
where nullif(trim(p.brand), '') is not null
   or nullif(trim(p.model), '') is not null
group by c.id, c.key, c.slug, p.brand, p.model;

revoke all on public.commerce_taxonomy_candidates_v from anon;
grant select on public.commerce_taxonomy_candidates_v to authenticated;
grant select on public.commerce_taxonomy_candidates_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC LISTING VIEW: keep SHOP-1 contract, expose IDs for exact filtering.
-- ------------------------------------------------------------

create or replace view public.commerce_public_listing_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.category as source_category,
  p.subtype as source_subtype,
  p.brand as source_brand,
  p.model as source_model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at as product_updated_at,

  cl.slug,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,

  c.key as category_key,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  c.slug as category_slug,

  b.name as catalog_brand_name,
  b.slug as catalog_brand_slug,

  s.name as series_name,
  s.slug as series_slug,

  m.model_name as catalog_model_name,
  m.model_code as catalog_model_code,
  m.slug as catalog_model_slug,

  pp.published_at,
  pp.updated_at as publication_updated_at,

  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order,
          'width', pi.width,
          'height', pi.height
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images,

  -- SHOP-2 appended columns. Appending preserves CREATE OR REPLACE VIEW compatibility.
  c.id as category_id,
  b.id as catalog_brand_id,
  s.id as series_id,
  m.id as catalog_model_id
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
left join public.commerce_listings cl
  on cl.product_id = p.id
left join public.commerce_categories c
  on c.id = cl.category_id
left join public.commerce_brands b
  on b.id = cl.brand_id
left join public.commerce_series s
  on s.id = cl.series_id
left join public.commerce_models m
  on m.id = cl.model_id
where cl.id is not null
  and (
    (pp.status = 'published' and p.status in ('published','reserved'))
    or (pp.status = 'ended' and p.status = 'sold')
  )
  and p.price is not null
  and p.price > 0;

revoke all on public.commerce_public_listing_v from anon;
revoke all on public.commerce_public_listing_v from authenticated;
grant select on public.commerce_public_listing_v to service_role;

-- ============================================================================
-- END SOURCE: supabase/shop_2.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_3.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-3 Product Detail SEO + Merchant Listing + Used Product Trust UX
-- Run after supabase/shop_2.sql. Safe to re-run.
--
-- Guardrails:
-- 1) No cost/profit/supplier/customer/employee fields are exposed to storefront.
-- 2) Shipping/return schema is emitted only when the merchant explicitly configures it.
-- 3) Used-product condition is explicit per listing and defaults to USED for the current second-hand catalog.
-- 4) Merchant eligibility is a readiness signal, not a promise that Google will show a rich result.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- LISTING MERCHANT CONDITION
-- ------------------------------------------------------------

alter table public.commerce_listings
  add column if not exists merchant_item_condition text not null default 'USED';

alter table public.commerce_listings
  drop constraint if exists commerce_listings_merchant_item_condition_check;

alter table public.commerce_listings
  add constraint commerce_listings_merchant_item_condition_check
  check (merchant_item_condition in ('NEW','USED','REFURBISHED','DAMAGED'));

-- ------------------------------------------------------------
-- STORE-WIDE PUBLIC MERCHANT POLICY SETTINGS
-- ------------------------------------------------------------
-- This table contains ONLY data that is safe to expose through the Store API.
-- Do not add secrets, credentials, banking data or internal notes here.

create table if not exists public.commerce_store_settings (
  id smallint primary key default 1 check (id = 1),
  merchant_name text not null default 'AMPHON TRADING',
  legal_name text,
  site_url text not null default 'https://shop.amphon.co.th',
  currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  country_code text not null default 'TH' check (country_code ~ '^[A-Z]{2}$'),

  -- Keep false until the storefront itself supports a purchase/order flow.
  purchase_enabled boolean not null default false,

  shipping_enabled boolean not null default false,
  shipping_country text default 'TH' check (shipping_country is null or shipping_country ~ '^[A-Z]{2}$'),
  shipping_rate numeric(12,2) check (shipping_rate is null or shipping_rate >= 0),
  handling_min_days integer check (handling_min_days is null or handling_min_days >= 0),
  handling_max_days integer check (handling_max_days is null or handling_max_days >= 0),
  transit_min_days integer check (transit_min_days is null or transit_min_days >= 0),
  transit_max_days integer check (transit_max_days is null or transit_max_days >= 0),
  shipping_policy_url text,

  return_policy_enabled boolean not null default false,
  return_policy_category text
    check (return_policy_category is null or return_policy_category in ('FINITE','NOT_PERMITTED','UNLIMITED')),
  return_days integer check (return_days is null or return_days >= 0),
  return_method text
    check (return_method is null or return_method in ('MAIL','IN_STORE','MAIL_AND_IN_STORE')),
  return_fees text
    check (return_fees is null or return_fees in ('FREE','CUSTOMER_RESPONSIBILITY')),
  return_policy_url text,

  warranty_policy_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.commerce_store_settings (id, merchant_name, site_url, currency, country_code)
values (1, 'AMPHON TRADING', 'https://shop.amphon.co.th', 'THB', 'TH')
on conflict (id) do nothing;

drop trigger if exists commerce_store_settings_touch on public.commerce_store_settings;
create trigger commerce_store_settings_touch
before update on public.commerce_store_settings
for each row execute procedure private.touch_commerce_row();

alter table public.commerce_store_settings enable row level security;
revoke all on public.commerce_store_settings from anon;
grant select, update on public.commerce_store_settings to authenticated;

drop policy if exists commerce_store_settings_read_staff on public.commerce_store_settings;
drop policy if exists commerce_store_settings_update_admin on public.commerce_store_settings;

create policy commerce_store_settings_read_staff
on public.commerce_store_settings for select to authenticated
using (public.current_user_active());

create policy commerce_store_settings_update_admin
on public.commerce_store_settings for update to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- MERCHANT READINESS VIEW FOR STAFF
-- ------------------------------------------------------------

create or replace view public.commerce_merchant_readiness_v
with (security_invoker = true)
as
select
  cl.product_id,
  p.sku,
  p.title,
  p.status as product_status,
  pp.status as website_status,
  cl.merchant_enabled,
  cl.merchant_item_condition,
  cl.index_policy,
  p.price,
  count(pi.id)::int as image_count,
  count(pi.id) filter (where pi.is_cover = true)::int as cover_image_count,
  count(pi.id) filter (where pi.image_role = 'defect')::int as defect_image_count,
  count(pi.id) filter (where pi.image_role = 'accessories')::int as accessory_image_count,
  count(pi.id) filter (where pi.image_role = 'warranty')::int as warranty_image_count,
  (
    p.title is not null and length(trim(p.title)) >= 4
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.merchant_item_condition is not null
    and cl.index_policy = 'INDEX'
  ) as data_ready,
  (
    s.purchase_enabled
    and cl.merchant_enabled
    and pp.status = 'published'
    and p.status = 'published'
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.index_policy = 'INDEX'
  ) as merchant_activation_ready,
  array_remove(array[
    case when p.title is null or length(trim(p.title)) < 4 then 'TITLE' end,
    case when p.price is null or p.price <= 0 then 'PRICE' end,
    case when count(pi.id) filter (where pi.public_url is not null) = 0 then 'IMAGE' end,
    case when cl.merchant_item_condition is null then 'ITEM_CONDITION' end,
    case when cl.index_policy <> 'INDEX' then 'INDEX_POLICY' end,
    case when not s.purchase_enabled then 'PURCHASE_FLOW_DISABLED' end,
    case when not cl.merchant_enabled then 'MERCHANT_DISABLED' end,
    case when pp.status <> 'published' then 'WEBSITE_NOT_PUBLISHED' end,
    case when p.status <> 'published' then 'PRODUCT_NOT_AVAILABLE' end
  ], null) as blockers,
  greatest(p.updated_at, cl.updated_at, pp.updated_at, s.updated_at) as updated_at
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
cross join public.commerce_store_settings s
left join public.product_images pi on pi.product_id = p.id
group by cl.product_id, p.sku, p.title, p.status, pp.status, cl.merchant_enabled,
  cl.merchant_item_condition, cl.index_policy, p.price, s.purchase_enabled,
  p.updated_at, cl.updated_at, pp.updated_at, s.updated_at;

revoke all on public.commerce_merchant_readiness_v from anon;
grant select on public.commerce_merchant_readiness_v to authenticated;
grant select on public.commerce_merchant_readiness_v to service_role;

-- ------------------------------------------------------------
-- SERVER-ONLY STORE SETTINGS PROJECTION
-- ------------------------------------------------------------

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  merchant_name,
  legal_name,
  site_url,
  currency,
  country_code,
  purchase_enabled,
  shipping_enabled,
  shipping_country,
  shipping_rate,
  handling_min_days,
  handling_max_days,
  transit_min_days,
  transit_max_days,
  shipping_policy_url,
  return_policy_enabled,
  return_policy_category,
  return_days,
  return_method,
  return_fees,
  return_policy_url,
  warranty_policy_url,
  updated_at
from public.commerce_store_settings
where id = 1;

revoke all on public.commerce_public_store_settings_v from anon;
revoke all on public.commerce_public_store_settings_v from authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- ------------------------------------------------------------
-- EXTEND SERVER-ONLY PUBLIC PRODUCT PROJECTION
-- ------------------------------------------------------------
-- Keep SHOP-2 column order and append SHOP-3 fields at the end so dependent
-- PostgREST clients remain backward compatible.

create or replace view public.commerce_public_listing_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.category as source_category,
  p.subtype as source_subtype,
  p.brand as source_brand,
  p.model as source_model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at as product_updated_at,

  cl.slug,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,

  c.key as category_key,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  c.slug as category_slug,

  b.name as catalog_brand_name,
  b.slug as catalog_brand_slug,

  s.name as series_name,
  s.slug as series_slug,

  m.model_name as catalog_model_name,
  m.model_code as catalog_model_code,
  m.slug as catalog_model_slug,

  pp.published_at,
  pp.updated_at as publication_updated_at,

  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order,
          'width', pi.width,
          'height', pi.height
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images,

  c.id as category_id,
  b.id as catalog_brand_id,
  s.id as series_id,
  m.id as catalog_model_id,

  -- SHOP-3 appended columns.
  cl.merchant_item_condition
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
left join public.commerce_listings cl
  on cl.product_id = p.id
left join public.commerce_categories c
  on c.id = cl.category_id
left join public.commerce_brands b
  on b.id = cl.brand_id
left join public.commerce_series s
  on s.id = cl.series_id
left join public.commerce_models m
  on m.id = cl.model_id
where cl.id is not null
  and (
    (pp.status = 'published' and p.status in ('published','reserved'))
    or (pp.status = 'ended' and p.status = 'sold')
  )
  and p.price is not null
  and p.price > 0;

revoke all on public.commerce_public_listing_v from anon;
revoke all on public.commerce_public_listing_v from authenticated;
grant select on public.commerce_public_listing_v to service_role;

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------

create index if not exists commerce_listings_merchant_idx
on public.commerce_listings(merchant_enabled, merchant_item_condition, updated_at desc);

-- ============================================================================
-- END SOURCE: supabase/shop_3.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_4.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-4 App Publish Center ↔ Shop Commerce Integration
-- Run after supabase/shop_3.sql. Safe to re-run.
--
-- Goals:
-- 1) Let the authenticated AMPHON app prepare/configure a Shop listing before Website publish.
-- 2) Expose one staff-safe editor projection with taxonomy + Merchant readiness.
-- 3) Keep taxonomy hierarchy valid at the database boundary.
-- 4) Keep checkout/Merchant activation LOCKED until SHOP-5 implements order/reservation checkout.
-- 5) Align Merchant condition values with Google Merchant Center: new / refurbished / used only.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- MERCHANT CONDITION CORRECTION
-- ------------------------------------------------------------
-- SHOP-3 allowed DAMAGED as a Schema.org condition. Google Merchant product data,
-- however, accepts only NEW / REFURBISHED / USED. Physical defects belong in
-- visible defect/condition content; a damaged second-hand item remains USED.

update public.commerce_listings
   set merchant_item_condition = 'USED'
 where merchant_item_condition = 'DAMAGED';

alter table public.commerce_listings
  drop constraint if exists commerce_listings_merchant_item_condition_check;

alter table public.commerce_listings
  add constraint commerce_listings_merchant_item_condition_check
  check (merchant_item_condition in ('NEW','USED','REFURBISHED'));

alter table public.commerce_listings
  drop constraint if exists commerce_listings_gtin_format_check;

alter table public.commerce_listings
  add constraint commerce_listings_gtin_format_check
  check (
    gtin is null
    or btrim(gtin) = ''
    or btrim(gtin) ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$'
  );

-- ------------------------------------------------------------
-- SHOP-4 PURCHASE ACTIVATION LOCK
-- ------------------------------------------------------------
-- Deliberately blocks accidental Merchant activation before SHOP-5.
-- SHOP-5 must explicitly DROP this constraint when checkout/order reservation
-- is implemented and production-tested.

update public.commerce_store_settings set purchase_enabled = false where id = 1;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop4_purchase_lock;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop4_purchase_lock
  check (purchase_enabled = false);

-- SHOP-3 could have an enabled but partial shipping configuration. Disable it
-- before adding the stronger SHOP-4 completeness invariant; do not fabricate
-- missing shipping rates or delivery windows.
update public.commerce_store_settings
   set shipping_enabled = false
 where shipping_enabled = true
   and (
     shipping_country is null
     or shipping_rate is null
     or handling_min_days is null
     or handling_max_days is null
     or transit_min_days is null
     or transit_max_days is null
   );

-- Old free-form settings may also contain inverted windows. Clear only the
-- invalid pair and disable shipping rather than guessing the intended values.
update public.commerce_store_settings
   set shipping_enabled = false, handling_min_days = null, handling_max_days = null
 where handling_min_days is not null and handling_max_days is not null
   and handling_min_days > handling_max_days;

update public.commerce_store_settings
   set shipping_enabled = false, transit_min_days = null, transit_max_days = null
 where transit_min_days is not null and transit_max_days is not null
   and transit_min_days > transit_max_days;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shipping_day_order_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shipping_day_order_check
  check (
    (handling_min_days is null or handling_max_days is null or handling_min_days <= handling_max_days)
    and (transit_min_days is null or transit_max_days is null or transit_min_days <= transit_max_days)
  );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shipping_completeness_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_shipping_completeness_check
  check (
    shipping_enabled = false
    or (
      shipping_country is not null
      and shipping_rate is not null
      and handling_min_days is not null
      and handling_max_days is not null
      and transit_min_days is not null
      and transit_max_days is not null
    )
  );

-- Disable legacy incomplete return settings instead of inventing a return
-- window or policy link during migration.
update public.commerce_store_settings
   set return_policy_enabled = false
 where return_policy_enabled = true
   and (
     (return_policy_category = 'FINITE' and return_days is null)
     or (return_policy_category is null and nullif(btrim(return_policy_url), '') is null)
   );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_return_window_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_return_window_check
  check (
    return_policy_enabled = false
    or return_policy_category <> 'FINITE'
    or return_days is not null
  );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_return_completeness_check;

alter table public.commerce_store_settings
  add constraint commerce_store_settings_return_completeness_check
  check (
    return_policy_enabled = false
    or return_policy_category is not null
    or nullif(btrim(return_policy_url), '') is not null
  );

-- ------------------------------------------------------------
-- TAXONOMY HIERARCHY VALIDATION
-- ------------------------------------------------------------

create or replace function private.validate_commerce_listing_hierarchy()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  series_row public.commerce_series%rowtype;
  model_row public.commerce_models%rowtype;
begin
  if new.series_id is not null then
    select * into series_row from public.commerce_series where id = new.series_id and is_active = true;
    if series_row.id is null then raise exception 'INVALID_SERIES'; end if;
    if new.category_id is distinct from series_row.category_id then raise exception 'SERIES_CATEGORY_MISMATCH'; end if;
    if new.brand_id is distinct from series_row.brand_id then raise exception 'SERIES_BRAND_MISMATCH'; end if;
  end if;

  if new.model_id is not null then
    select * into model_row from public.commerce_models where id = new.model_id and is_active = true;
    if model_row.id is null then raise exception 'INVALID_MODEL'; end if;
    if new.category_id is distinct from model_row.category_id then raise exception 'MODEL_CATEGORY_MISMATCH'; end if;
    if new.brand_id is distinct from model_row.brand_id then raise exception 'MODEL_BRAND_MISMATCH'; end if;
    if model_row.series_id is not null and new.series_id is distinct from model_row.series_id then
      raise exception 'MODEL_SERIES_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_commerce_listing_hierarchy() from public;
revoke all on function private.validate_commerce_listing_hierarchy() from anon;
revoke all on function private.validate_commerce_listing_hierarchy() from authenticated;

drop trigger if exists commerce_listings_validate_hierarchy on public.commerce_listings;
create trigger commerce_listings_validate_hierarchy
before insert or update of category_id, brand_id, series_id, model_id
on public.commerce_listings
for each row execute procedure private.validate_commerce_listing_hierarchy();

-- ------------------------------------------------------------
-- PREPARE LISTING RPC
-- ------------------------------------------------------------
-- Allows Publish Center to generate the stable Shop slug and taxonomy mapping
-- before the Website publication row is created. It never publishes the product.

create or replace function public.prepare_commerce_listing(target_product_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  mapped_category_id uuid;
  listing_id uuid;
begin
  if public.current_user_role() not in ('owner','admin','sales') then
    raise exception 'FORBIDDEN';
  end if;

  select * into p from public.products where id = target_product_id;
  if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select c.id into mapped_category_id
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = p.category
     and (c.source_subtype = p.subtype or c.source_subtype is null)
   order by (c.source_subtype is not null) desc, c.is_default_source desc, c.sort_order asc
   limit 1;

  insert into public.commerce_listings (
    product_id, category_id, slug, seo_title, seo_description, index_policy, published_at
  )
  values (
    p.id,
    mapped_category_id,
    private.commerce_slug_base(p.title, p.sku),
    left(p.title || ' มือสอง | AMPHON TRADING', 180),
    left(concat_ws(' ', p.title, case when p.brand is not null then 'แบรนด์ ' || p.brand end,
      'สินค้ามือสองพร้อมข้อมูลสภาพ ราคาและรายละเอียดสินค้าจริงจาก AMPHON TRADING'), 300),
    case when p.status in ('ready_to_list','published','reserved','sold') then 'INDEX' else 'HOLD' end,
    null
  )
  on conflict (product_id) do update
    set category_id = coalesce(public.commerce_listings.category_id, excluded.category_id),
        updated_at = now()
  returning id into listing_id;

  perform private.sync_commerce_listing_taxonomy(p.id);
  return listing_id;
end;
$$;

revoke all on function public.prepare_commerce_listing(uuid) from public;
revoke all on function public.prepare_commerce_listing(uuid) from anon;
grant execute on function public.prepare_commerce_listing(uuid) to authenticated;

-- ------------------------------------------------------------
-- CANONICAL PUBLICATION URL SYNC
-- ------------------------------------------------------------

create or replace function private.sync_website_publication_canonical_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sku_value text;
  shop_origin text;
begin
  select p.sku into sku_value from public.products p where p.id = new.product_id;
  select regexp_replace(s.site_url, '/+$', '') into shop_origin
    from public.commerce_store_settings s where s.id = 1;

  if sku_value is not null and shop_origin is not null then
    update public.product_publications
       set external_url = shop_origin || '/p/' || new.slug || '-' || lower(sku_value) || '/',
           listing_ref = coalesce(listing_ref, sku_value),
           updated_at = now()
     where product_id = new.product_id
       and channel = 'website';
  end if;

  return new;
end;
$$;

revoke all on function private.sync_website_publication_canonical_url() from public;
revoke all on function private.sync_website_publication_canonical_url() from anon;
revoke all on function private.sync_website_publication_canonical_url() from authenticated;

drop trigger if exists commerce_listings_sync_website_url on public.commerce_listings;
create trigger commerce_listings_sync_website_url
after insert or update of slug on public.commerce_listings
for each row execute procedure private.sync_website_publication_canonical_url();

-- Backfill canonical URLs for Website publication history.
update public.product_publications pp
   set external_url = regexp_replace(s.site_url, '/+$', '') || '/p/' || cl.slug || '-' || lower(p.sku) || '/',
       listing_ref = coalesce(pp.listing_ref, p.sku),
       updated_at = now()
  from public.commerce_listings cl
  join public.products p on p.id = cl.product_id
 cross join public.commerce_store_settings s
 where pp.product_id = p.id
   and pp.channel = 'website';

-- ------------------------------------------------------------
-- MERCHANT READINESS: PRE-PUBLISH AWARE
-- ------------------------------------------------------------

create or replace view public.commerce_merchant_readiness_v
with (security_invoker = true)
as
select
  cl.product_id,
  p.sku,
  p.title,
  p.status as product_status,
  coalesce(pp.status, 'not_published') as website_status,
  cl.merchant_enabled,
  cl.merchant_item_condition,
  cl.index_policy,
  p.price,
  count(pi.id)::int as image_count,
  count(pi.id) filter (where pi.is_cover = true)::int as cover_image_count,
  count(pi.id) filter (where pi.image_role = 'defect')::int as defect_image_count,
  count(pi.id) filter (where pi.image_role = 'accessories')::int as accessory_image_count,
  count(pi.id) filter (where pi.image_role = 'warranty')::int as warranty_image_count,
  (
    p.title is not null and length(trim(p.title)) >= 4
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.merchant_item_condition in ('NEW','USED','REFURBISHED')
    and cl.index_policy = 'INDEX'
    and (cl.gtin is null or btrim(cl.gtin) = '' or btrim(cl.gtin) ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$')
  ) as data_ready,
  (
    s.purchase_enabled
    and cl.merchant_enabled
    and pp.status = 'published'
    and p.status = 'published'
    and p.price is not null and p.price > 0
    and count(pi.id) filter (where pi.public_url is not null) > 0
    and cl.merchant_item_condition in ('NEW','USED','REFURBISHED')
    and cl.index_policy = 'INDEX'
  ) as merchant_activation_ready,
  array_remove(array[
    case when p.title is null or length(trim(p.title)) < 4 then 'TITLE' end,
    case when p.price is null or p.price <= 0 then 'PRICE' end,
    case when count(pi.id) filter (where pi.public_url is not null) = 0 then 'IMAGE' end,
    case when cl.merchant_item_condition not in ('NEW','USED','REFURBISHED') then 'ITEM_CONDITION' end,
    case when cl.index_policy <> 'INDEX' then 'INDEX_POLICY' end,
    case when cl.gtin is not null and btrim(cl.gtin) <> '' and btrim(cl.gtin) !~ '^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$' then 'GTIN_INVALID' end,
    case when not s.purchase_enabled then 'PURCHASE_FLOW_DISABLED' end,
    case when not cl.merchant_enabled then 'MERCHANT_DISABLED' end,
    case when pp.status is null or pp.status <> 'published' then 'WEBSITE_NOT_PUBLISHED' end,
    case when p.status <> 'published' then 'PRODUCT_NOT_AVAILABLE' end
  ], null) as blockers,
  greatest(p.updated_at, cl.updated_at, pp.updated_at, s.updated_at) as updated_at
from public.commerce_listings cl
join public.products p on p.id = cl.product_id
left join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website'
cross join public.commerce_store_settings s
left join public.product_images pi on pi.product_id = p.id
group by cl.product_id, p.sku, p.title, p.status, pp.status, cl.merchant_enabled,
  cl.merchant_item_condition, cl.index_policy, cl.gtin, p.price, s.purchase_enabled,
  p.updated_at, cl.updated_at, pp.updated_at, s.updated_at;

revoke all on public.commerce_merchant_readiness_v from anon;
grant select on public.commerce_merchant_readiness_v to authenticated;
grant select on public.commerce_merchant_readiness_v to service_role;

-- ------------------------------------------------------------
-- STAFF-SAFE COMMERCE EDITOR VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_listing_editor_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.title,
  p.status as product_status,
  cl.id as listing_id,
  cl.slug,
  '/p/' || cl.slug || '-' || lower(p.sku) || '/' as canonical_path,
  cl.category_id,
  c.name_th as category_name,
  cl.brand_id,
  b.name as brand_name,
  cl.series_id,
  s.name as series_name,
  cl.model_id,
  m.model_name,
  cl.seo_title,
  cl.seo_description,
  cl.index_policy,
  cl.merchant_enabled,
  cl.merchant_item_condition,
  cl.google_product_category,
  cl.gtin,
  cl.mpn,
  coalesce(r.website_status, 'not_published') as website_status,
  coalesce(r.data_ready, false) as data_ready,
  coalesce(r.merchant_activation_ready, false) as merchant_activation_ready,
  coalesce(r.blockers, array[]::text[]) as blockers,
  cl.updated_at
from public.products p
join public.commerce_listings cl on cl.product_id = p.id
left join public.commerce_categories c on c.id = cl.category_id
left join public.commerce_brands b on b.id = cl.brand_id
left join public.commerce_series s on s.id = cl.series_id
left join public.commerce_models m on m.id = cl.model_id
left join public.commerce_merchant_readiness_v r on r.product_id = p.id;

revoke all on public.commerce_listing_editor_v from anon;
grant select on public.commerce_listing_editor_v to authenticated;
grant select on public.commerce_listing_editor_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC STORE SETTINGS VIEW: keep server-only, append no secrets.
-- ------------------------------------------------------------

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  merchant_name,
  legal_name,
  site_url,
  currency,
  country_code,
  purchase_enabled,
  shipping_enabled,
  shipping_country,
  shipping_rate,
  handling_min_days,
  handling_max_days,
  transit_min_days,
  transit_max_days,
  shipping_policy_url,
  return_policy_enabled,
  return_policy_category,
  return_days,
  return_method,
  return_fees,
  return_policy_url,
  warranty_policy_url,
  updated_at
from public.commerce_store_settings
where id = 1;

revoke all on public.commerce_public_store_settings_v from anon;
revoke all on public.commerce_public_store_settings_v from authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- ============================================================================
-- END SOURCE: supabase/shop_4.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_5.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-5 Cart + Atomic Reservation + Checkout + Order Management
-- Run after supabase/shop_4.sql. Safe to re-run.
--
-- Design principles
-- 1) Product Hub remains inventory source of truth.
-- 2) A checkout reservation is created atomically in PostgreSQL, never in the browser.
-- 3) Public checkout/order PII is never exposed through anon/authenticated table access.
-- 4) Checkout retries use an idempotency key.
-- 5) Product status is RESERVED while payment is pending and SOLD only after staff confirms payment.
-- 6) Expired unpaid reservations are released back to PUBLISHED automatically.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- STORE CHECKOUT CONFIGURATION
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists reservation_minutes integer not null default 60,
  add column if not exists payment_review_hold_hours integer not null default 24,
  add column if not exists bank_transfer_enabled boolean not null default false,
  add column if not exists bank_name text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_number text,
  add column if not exists pay_at_store_enabled boolean not null default false,
  add column if not exists pickup_enabled boolean not null default true,
  add column if not exists checkout_terms_url text,
  add column if not exists checkout_turnstile_enabled boolean not null default false,
  add column if not exists turnstile_site_key text;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop4_purchase_lock;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_reservation_window_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_reservation_window_check
  check (reservation_minutes between 10 and 240 and payment_review_hold_hours between 1 and 72);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_bank_transfer_complete_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_bank_transfer_complete_check
  check (
    bank_transfer_enabled = false
    or (
      nullif(btrim(bank_name), '') is not null
      and nullif(btrim(bank_account_name), '') is not null
      and nullif(btrim(bank_account_number), '') is not null
    )
  );

-- To enable purchase/merchant offers, the store must have real shipping/payment/return
-- configuration and bot protection. Disable an older/incomplete activation before installing
-- the stronger SHOP-5 constraint so this migration remains safe to re-run.
update public.commerce_store_settings
   set purchase_enabled = false
 where purchase_enabled = true
   and (
     shipping_enabled is not true
     or bank_transfer_enabled is not true
     or return_policy_enabled is not true
     or checkout_turnstile_enabled is not true
     or nullif(btrim(turnstile_site_key), '') is null
     or nullif(btrim(site_url), '') is null
   );

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop5_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop5_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and bank_transfer_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
    )
  );

-- ------------------------------------------------------------
-- ORDERS / ORDER ITEMS / ACTIVE RESERVATIONS
-- ------------------------------------------------------------

create sequence if not exists public.commerce_order_seq;

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  idempotency_key uuid not null unique,
  order_number text not null unique,
  order_status text not null default 'AWAITING_PAYMENT'
    check (order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW','PROCESSING','SHIPPED','COMPLETED','CANCELLED','EXPIRED','REFUNDED')),
  payment_status text not null default 'UNPAID'
    check (payment_status in ('UNPAID','REVIEW','PAID','REFUNDED')),
  fulfillment_status text not null default 'UNFULFILLED'
    check (fulfillment_status in ('UNFULFILLED','PACKING','SHIPPED','DELIVERED','PICKUP_READY','PICKED_UP','CANCELLED')),
  payment_method text not null
    check (payment_method in ('BANK_TRANSFER','PAY_AT_STORE')),
  delivery_method text not null
    check (delivery_method in ('SHIPPING','PICKUP')),

  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  address_line text,
  subdistrict text,
  district text,
  province text,
  postal_code text,
  customer_note text,

  currency text not null default 'THB',
  subtotal numeric(12,2) not null check (subtotal >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null check (total >= 0),

  reservation_expires_at timestamptz not null,
  payment_reference text,
  payment_notified_at timestamptz,
  paid_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  refunded_at timestamptz,
  tracking_carrier text,
  tracking_number text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  sku text not null,
  title text not null,
  unit_price numeric(12,2) not null check (unit_price > 0),
  quantity integer not null default 1 check (quantity = 1),
  merchant_item_condition text not null default 'USED'
    check (merchant_item_condition in ('NEW','USED','REFURBISHED')),
  created_at timestamptz not null default now(),
  unique(order_id, product_id)
);

-- One active reservation row per physical product. Removing this row releases the SKU.
create table if not exists public.commerce_reservations (
  product_id uuid primary key references public.products(id) on delete cascade,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists commerce_orders_status_idx
  on public.commerce_orders(order_status, created_at desc);
create index if not exists commerce_orders_payment_idx
  on public.commerce_orders(payment_status, created_at desc);
create index if not exists commerce_orders_reservation_expiry_idx
  on public.commerce_orders(reservation_expires_at)
  where order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW');
create index if not exists commerce_order_items_order_idx
  on public.commerce_order_items(order_id);
create index if not exists commerce_order_items_product_idx
  on public.commerce_order_items(product_id);
create index if not exists commerce_reservations_expiry_idx
  on public.commerce_reservations(expires_at);

create or replace function public.touch_commerce_order()
returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists commerce_orders_touch on public.commerce_orders;
create trigger commerce_orders_touch
before update on public.commerce_orders
for each row execute procedure public.touch_commerce_order();

alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_reservations enable row level security;

-- Checkout/order PII is server-only. Product Hub staff reaches it through the authenticated Worker.
revoke all on public.commerce_orders from anon, authenticated;
revoke all on public.commerce_order_items from anon, authenticated;
revoke all on public.commerce_reservations from anon, authenticated;
grant select, insert, update, delete on public.commerce_orders to service_role;
grant select, insert, update, delete on public.commerce_order_items to service_role;
grant select, insert, update, delete on public.commerce_reservations to service_role;

-- ------------------------------------------------------------
-- INTERNAL RELEASE / EXPIRY HELPERS
-- ------------------------------------------------------------

create or replace function private.release_commerce_order_inventory(target_order_id uuid, terminal_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  released integer := 0;
begin
  -- All order mutations lock the order first, then products. Keep one global lock order
  -- to avoid expiry/payment-confirmation deadlocks.
  perform 1
    from public.commerce_orders o
   where o.id = target_order_id
     and o.payment_status in ('UNPAID','REVIEW')
     and o.order_status not in ('CANCELLED','EXPIRED','COMPLETED','REFUNDED')
   for update;
  if not found then return 0; end if;

  -- Lock every product in deterministic order before releasing.
  for item in
    select oi.product_id
      from public.commerce_order_items oi
     where oi.order_id = target_order_id
     order by oi.product_id
     for update
  loop
    perform 1 from public.products p where p.id = item.product_id for update;
    update public.products p
       set status = 'published', updated_by = null
     where p.id = item.product_id
       and p.status = 'reserved'
       and exists (
         select 1 from public.commerce_reservations r
          where r.product_id = p.id and r.order_id = target_order_id
       );
    if found then released := released + 1; end if;
  end loop;

  delete from public.commerce_reservations r where r.order_id = target_order_id;

  update public.commerce_orders o
     set order_status = terminal_status,
         fulfillment_status = 'CANCELLED',
         cancelled_at = case when terminal_status = 'CANCELLED' then now() else o.cancelled_at end,
         expired_at = case when terminal_status = 'EXPIRED' then now() else o.expired_at end
   where o.id = target_order_id
     and o.payment_status in ('UNPAID','REVIEW');

  return released;
end;
$$;

revoke all on function private.release_commerce_order_inventory(uuid,text) from public, anon, authenticated;

create or replace function public.expire_commerce_reservations(max_orders integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  affected integer := 0;
begin
  for target in
    select o.id
      from public.commerce_orders o
     where o.order_status in ('AWAITING_PAYMENT','PAYMENT_REVIEW')
       and o.payment_status in ('UNPAID','REVIEW')
       and o.reservation_expires_at <= now()
     order by o.reservation_expires_at asc
     limit greatest(1, least(coalesce(max_orders,100),500))
     for update skip locked
  loop
    perform private.release_commerce_order_inventory(target.id, 'EXPIRED');
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

revoke all on function public.expire_commerce_reservations(integer) from public, anon, authenticated;
grant execute on function public.expire_commerce_reservations(integer) to service_role;

-- ------------------------------------------------------------
-- ATOMIC PUBLIC CHECKOUT RPC (SERVICE ROLE ONLY)
-- ------------------------------------------------------------

create or replace function public.create_commerce_order(checkout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.commerce_store_settings%rowtype;
  existing public.commerce_orders%rowtype;
  new_order public.commerce_orders%rowtype;
  requested_skus text[];
  locked_product record;
  item_count integer;
  validated_count integer := 0;
  subtotal_amount numeric(12,2) := 0;
  shipping_amount_value numeric(12,2) := 0;
  total_amount numeric(12,2) := 0;
  expires_at_value timestamptz;
  idem uuid;
  payment_method_value text;
  delivery_method_value text;
  customer_name_value text;
  customer_phone_value text;
  customer_email_value text;
  stale record;
begin
  select * into settings from public.commerce_store_settings where id = 1 for share;
  if settings.id is null or settings.purchase_enabled is not true then raise exception 'CHECKOUT_DISABLED'; end if;

  begin idem := (checkout->>'idempotencyKey')::uuid; exception when others then raise exception 'INVALID_IDEMPOTENCY_KEY'; end;
  -- Serialize retries/double-clicks carrying the same idempotency key before checking/inserting.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(idem::text, 0));
  select * into existing from public.commerce_orders where idempotency_key = idem;
  if existing.id is not null then
    return jsonb_build_object('orderId',existing.id,'publicToken',existing.public_token,'orderNumber',existing.order_number,
      'orderStatus',existing.order_status,'paymentStatus',existing.payment_status,'reservationExpiresAt',existing.reservation_expires_at,
      'subtotal',existing.subtotal,'shippingAmount',existing.shipping_amount,'total',existing.total,'currency',existing.currency);
  end if;

  select array_agg(distinct upper(btrim(v)) order by upper(btrim(v)))
    into requested_skus
    from jsonb_array_elements_text(coalesce(checkout->'skus','[]'::jsonb)) t(v)
   where btrim(v) <> '';
  item_count := coalesce(cardinality(requested_skus),0);
  if item_count < 1 or item_count > 10 then raise exception 'INVALID_CART_SIZE'; end if;

  customer_name_value := left(btrim(coalesce(checkout->>'customerName','')),120);
  customer_phone_value := left(regexp_replace(coalesce(checkout->>'customerPhone',''),'[^0-9+]','','g'),30);
  customer_email_value := nullif(left(btrim(coalesce(checkout->>'customerEmail','')),180),'');
  if char_length(customer_name_value) < 2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  if char_length(customer_phone_value) < 8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;

  payment_method_value := upper(coalesce(checkout->>'paymentMethod','BANK_TRANSFER'));
  delivery_method_value := upper(coalesce(checkout->>'deliveryMethod','SHIPPING'));
  if payment_method_value not in ('BANK_TRANSFER','PAY_AT_STORE') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if delivery_method_value not in ('SHIPPING','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;
  if payment_method_value = 'BANK_TRANSFER' and settings.bank_transfer_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value = 'PAY_AT_STORE' and (settings.pay_at_store_enabled is not true or settings.pickup_enabled is not true or delivery_method_value <> 'PICKUP') then
    raise exception 'PAYMENT_METHOD_DISABLED';
  end if;
  if delivery_method_value = 'PICKUP' and settings.pickup_enabled is not true then raise exception 'PICKUP_DISABLED'; end if;
  if delivery_method_value = 'SHIPPING' then
    if settings.shipping_enabled is not true then raise exception 'SHIPPING_DISABLED'; end if;
    if nullif(btrim(coalesce(checkout->>'addressLine','')), '') is null
       or nullif(btrim(coalesce(checkout->>'district','')), '') is null
       or nullif(btrim(coalesce(checkout->>'province','')), '') is null
       or nullif(btrim(coalesce(checkout->>'postalCode','')), '') is null then
      raise exception 'SHIPPING_ADDRESS_REQUIRED';
    end if;
    shipping_amount_value := coalesce(settings.shipping_rate,0);
  end if;

  -- Confirm all SKU identities exist before stale-release work. Availability is checked under row locks below.
  if (select count(*) from public.products p where p.sku = any(requested_skus)) <> item_count then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Release stale holds BEFORE taking requested product locks. This avoids lock-order inversion
  -- when an expired multi-item order overlaps a new cart.
  for stale in
    select distinct r.order_id
      from public.commerce_reservations r
      join public.products p on p.id = r.product_id
     where p.sku = any(requested_skus)
       and r.expires_at <= now()
  loop
    perform private.release_commerce_order_inventory(stale.order_id, 'EXPIRED');
  end loop;

  -- Lock requested products in deterministic SKU order and validate public sale state + price snapshot.
  for locked_product in
    select p.id, p.sku, p.title, p.status, p.price,
           coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition
      from public.products p
      join public.product_publications pp on pp.product_id = p.id and pp.channel = 'website' and pp.status = 'published'
      left join public.commerce_listings cl on cl.product_id = p.id
     where p.sku = any(requested_skus)
     order by p.sku
     for update of p
  loop
    if locked_product.status <> 'published' then raise exception 'PRODUCT_UNAVAILABLE:%', locked_product.sku; end if;
    if locked_product.price is null or locked_product.price <= 0 then raise exception 'PRODUCT_PRICE_INVALID:%', locked_product.sku; end if;
    if exists (select 1 from public.commerce_reservations r where r.product_id = locked_product.id) then
      raise exception 'PRODUCT_RESERVED:%', locked_product.sku;
    end if;
    validated_count := validated_count + 1;
    subtotal_amount := subtotal_amount + locked_product.price;
  end loop;

  if validated_count <> item_count then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if subtotal_amount <= 0 then raise exception 'EMPTY_CART'; end if;
  total_amount := subtotal_amount + shipping_amount_value;
  expires_at_value := now() + make_interval(mins => settings.reservation_minutes);

  insert into public.commerce_orders (
    idempotency_key, order_number, payment_method, delivery_method,
    customer_name, customer_phone, customer_email,
    address_line, subdistrict, district, province, postal_code, customer_note,
    currency, subtotal, shipping_amount, total, reservation_expires_at
  ) values (
    idem,
    'ATSO-' || to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_order_seq')::text,6,'0'),
    payment_method_value, delivery_method_value,
    customer_name_value, customer_phone_value, customer_email_value,
    nullif(left(btrim(coalesce(checkout->>'addressLine','')),250),''),
    nullif(left(btrim(coalesce(checkout->>'subdistrict','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'district','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'province','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'postalCode','')),20),''),
    nullif(left(btrim(coalesce(checkout->>'note','')),500),''),
    coalesce(settings.currency,'THB'), subtotal_amount, shipping_amount_value, total_amount, expires_at_value
  ) returning * into new_order;

  for locked_product in
    select p.id, p.sku, p.title, p.price, coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition
      from public.products p
      left join public.commerce_listings cl on cl.product_id = p.id
     where p.sku = any(requested_skus)
     order by p.sku
  loop
    insert into public.commerce_order_items(order_id,product_id,sku,title,unit_price,merchant_item_condition)
    values (new_order.id,locked_product.id,locked_product.sku,locked_product.title,locked_product.price,locked_product.merchant_item_condition);
    insert into public.commerce_reservations(product_id,order_id,expires_at)
    values (locked_product.id,new_order.id,expires_at_value);
    update public.products set status = 'reserved', updated_by = null where id = locked_product.id and status = 'published';
    if not found then raise exception 'PRODUCT_RESERVATION_RACE:%', locked_product.sku; end if;
  end loop;

  return jsonb_build_object(
    'orderId',new_order.id,'publicToken',new_order.public_token,'orderNumber',new_order.order_number,
    'orderStatus',new_order.order_status,'paymentStatus',new_order.payment_status,
    'reservationExpiresAt',new_order.reservation_expires_at,
    'subtotal',new_order.subtotal,'shippingAmount',new_order.shipping_amount,'total',new_order.total,'currency',new_order.currency
  );
end;
$$;

revoke all on function public.create_commerce_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_commerce_order(jsonb) to service_role;

-- ------------------------------------------------------------
-- CUSTOMER PAYMENT NOTIFICATION
-- ------------------------------------------------------------

create or replace function public.notify_commerce_payment(target_public_token uuid, payment_reference_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  settings public.commerce_store_settings%rowtype;
  new_expiry timestamptz;
begin
  select * into target from public.commerce_orders where public_token = target_public_token for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.order_status in ('CANCELLED','EXPIRED','REFUNDED','COMPLETED') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if target.payment_status = 'PAID' then
    return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status);
  end if;
  if target.reservation_expires_at <= now() and target.payment_status in ('UNPAID','REVIEW') then
    perform private.release_commerce_order_inventory(target.id,'EXPIRED');
    raise exception 'RESERVATION_EXPIRED';
  end if;
  if target.payment_method <> 'BANK_TRANSFER' then raise exception 'PAYMENT_NOTIFICATION_NOT_REQUIRED'; end if;
  -- Repeated clicks while already under review are idempotent and must not extend the hold forever.
  if target.payment_status = 'REVIEW' then
    return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,
      'reservationExpiresAt',target.reservation_expires_at);
  end if;

  select * into settings from public.commerce_store_settings where id = 1;
  new_expiry := greatest(target.reservation_expires_at, now() + make_interval(hours => coalesce(settings.payment_review_hold_hours,24)));

  update public.commerce_orders
     set order_status = 'PAYMENT_REVIEW', payment_status = 'REVIEW',
         payment_reference = nullif(left(btrim(coalesce(payment_reference_value,'')),180),''),
         payment_notified_at = coalesce(payment_notified_at,now()),
         reservation_expires_at = new_expiry
   where id = target.id
   returning * into target;
  update public.commerce_reservations set expires_at = new_expiry where order_id = target.id;

  return jsonb_build_object('orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,
    'reservationExpiresAt',target.reservation_expires_at);
end;
$$;

revoke all on function public.notify_commerce_payment(uuid,text) from public, anon, authenticated;
grant execute on function public.notify_commerce_payment(uuid,text) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER ACTIONS (WORKER AUTHORIZES ROLE; DB KEEPS TRANSITIONS ATOMIC)
-- ------------------------------------------------------------

create or replace function public.admin_commerce_order_action(
  target_order_id uuid,
  action_name text,
  actor_id uuid,
  action_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
  action text := upper(btrim(action_name));
begin
  select * into target from public.commerce_orders where id = target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if action = 'CONFIRM_PAYMENT' then
    if target.payment_status = 'PAID' then null;
    elsif target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then raise exception 'ORDER_NOT_PAYABLE';
    else
      for item in select product_id from public.commerce_order_items where order_id = target.id order by product_id loop
        perform 1 from public.products where id = item.product_id for update;
        update public.products set status = 'sold', updated_by = actor_id where id = item.product_id and status = 'reserved';
        if not found then raise exception 'RESERVED_PRODUCT_STATE_MISMATCH'; end if;
      end loop;
      delete from public.commerce_reservations where order_id = target.id;
      update public.commerce_orders
         set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=now()
       where id=target.id;
    end if;
  elsif action = 'CANCEL' then
    if target.payment_status = 'PAID' then raise exception 'PAID_ORDER_REQUIRES_REFUND'; end if;
    if target.order_status not in ('CANCELLED','EXPIRED') then
      perform private.release_commerce_order_inventory(target.id,'CANCELLED');
    end if;
  elsif action = 'MARK_PACKING' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING', fulfillment_status='PACKING' where id=target.id;
  elsif action = 'MARK_SHIPPED' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method <> 'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    update public.commerce_orders
       set order_status='SHIPPED', fulfillment_status='SHIPPED', shipped_at=coalesce(shipped_at,now()),
           tracking_carrier=nullif(left(btrim(coalesce(action_data->>'trackingCarrier','')),100),''),
           tracking_number=nullif(left(btrim(coalesce(action_data->>'trackingNumber','')),120),'')
     where id=target.id;
  elsif action = 'MARK_PICKUP_READY' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method <> 'PICKUP' then raise exception 'PICKUP_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING', fulfillment_status='PICKUP_READY' where id=target.id;
  elsif action = 'COMPLETE' then
    if target.payment_status <> 'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method = 'SHIPPING' and target.fulfillment_status <> 'SHIPPED' then raise exception 'SHIPMENT_NOT_READY'; end if;
    if target.delivery_method = 'PICKUP' and target.fulfillment_status <> 'PICKUP_READY' then raise exception 'PICKUP_NOT_READY'; end if;
    update public.commerce_orders
       set order_status='COMPLETED',
           fulfillment_status=case when delivery_method='PICKUP' then 'PICKED_UP' else 'DELIVERED' end,
           completed_at=coalesce(completed_at,now())
     where id=target.id;
  elsif action = 'REFUND' then
    if target.payment_status <> 'PAID' then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id = target.id order by product_id loop
      perform 1 from public.products where id = item.product_id for update;
      update public.products set status='returned', updated_by=actor_id where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders
       set payment_status='REFUNDED', order_status='REFUNDED', fulfillment_status='CANCELLED', refunded_at=now()
     where id=target.id;
  else
    raise exception 'INVALID_ORDER_ACTION';
  end if;

  select * into target from public.commerce_orders where id=target_order_id;
  insert into public.activity_logs(actor_id, action, metadata)
  values (actor_id, 'commerce_order_' || lower(action), jsonb_build_object('orderId',target.id,'orderNumber',target.order_number));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'orderStatus',target.order_status,
    'paymentStatus',target.payment_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF-SAFE ADMIN VIEW (PII IS AUTHENTICATED APP DATA, NEVER STORE API DATA)
-- ------------------------------------------------------------

create or replace view public.commerce_order_admin_v
with (security_invoker = true)
as
select
  o.id, o.order_number, o.order_status, o.payment_status, o.fulfillment_status,
  o.payment_method, o.delivery_method,
  o.customer_name, o.customer_phone, o.customer_email,
  o.address_line, o.subdistrict, o.district, o.province, o.postal_code, o.customer_note,
  o.currency, o.subtotal, o.shipping_amount, o.total,
  o.reservation_expires_at, o.payment_reference, o.payment_notified_at, o.paid_at,
  o.tracking_carrier, o.tracking_number, o.shipped_at, o.completed_at, o.cancelled_at, o.expired_at, o.refunded_at,
  o.created_at, o.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object(
    'productId',oi.product_id,'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'condition',oi.merchant_item_condition
  ) order by oi.created_at) from public.commerce_order_items oi where oi.order_id=o.id),'[]'::jsonb) as items
from public.commerce_orders o;

revoke all on public.commerce_order_admin_v from anon, authenticated;
grant select on public.commerce_order_admin_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC PRODUCT/STORE PROJECTION REFRESH
-- ------------------------------------------------------------
-- Store API reads this server-only view. Include checkout capability without exposing bank details.

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  merchant_name, legal_name, site_url, currency, country_code, purchase_enabled,
  shipping_enabled, shipping_country, shipping_rate, handling_min_days, handling_max_days,
  transit_min_days, transit_max_days, shipping_policy_url,
  return_policy_enabled, return_policy_category, return_days, return_method, return_fees, return_policy_url,
  warranty_policy_url,
  updated_at,
  reservation_minutes, bank_transfer_enabled, pay_at_store_enabled, pickup_enabled, checkout_terms_url,
  checkout_turnstile_enabled, turnstile_site_key
from public.commerce_store_settings
where id=1;

revoke all on public.commerce_public_store_settings_v from anon, authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- Existing merchant readiness view should now become activation-ready when the real checkout is enabled.
-- Recreate SHOP-4 editor view with purchase lock removed from its semantics by keeping the same source flag.

-- Realtime is not required for public checkout; staff order screens poll/refetch through Worker.
-- ============================================================================
-- END SOURCE: supabase/shop_5.sql
-- ============================================================================


-- ============================================================================
-- BEGIN SOURCE: supabase/shop_6.sql
-- ============================================================================
-- AMPHON SHOP — SHOP-6 Payment Gateway + Shipping / Tracking + Invoice / Warranty Fulfillment
-- Run after supabase/shop_5.sql. Safe to re-run.
--
-- Safety contract:
-- 1) Product Hub remains inventory source of truth.
-- 2) Stripe/browser redirects are never payment evidence; only a verified provider webhook can mark Stripe orders paid.
-- 3) Payment amount + currency must match the immutable order total before reserved physical SKUs become SOLD.
-- 4) Provider event IDs are unique/idempotent.
-- 5) Full refunds move SOLD physical SKUs to RETURNED, never back to PUBLISHED automatically.
-- 6) Documents snapshot order/seller/customer/item data at issuance.
-- 7) Warranty duration/terms are snapshotted into order items at checkout and cannot be changed retroactively.
-- 8) Secrets stay in the Cloudflare Worker; this migration stores no gateway credentials.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- STORE PAYMENT / DOCUMENT / WARRANTY CONFIGURATION
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists stripe_enabled boolean not null default false,
  add column if not exists stripe_promptpay_enabled boolean not null default false,
  add column if not exists document_mode text not null default 'RECEIPT_ONLY',
  add column if not exists invoice_seller_name text,
  add column if not exists invoice_tax_id text,
  add column if not exists invoice_branch_code text,
  add column if not exists invoice_address text,
  add column if not exists invoice_email text,
  add column if not exists default_warranty_days integer not null default 0,
  add column if not exists default_warranty_terms text;

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_document_mode_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_document_mode_check
  check (document_mode in ('RECEIPT_ONLY','INVOICE_RECEIPT','VAT_TAX_INVOICE'));

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_warranty_days_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_warranty_days_check
  check (default_warranty_days between 0 and 3650);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_stripe_reservation_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_stripe_reservation_check
  check (stripe_enabled = false or reservation_minutes between 45 and 240);

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_promptpay_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_promptpay_check
  check (stripe_promptpay_enabled = false or (stripe_enabled = true and currency = 'THB'));

alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_tax_invoice_config_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_tax_invoice_config_check
  check (
    document_mode <> 'VAT_TAX_INVOICE'
    or (
      nullif(btrim(invoice_seller_name), '') is not null
      and nullif(btrim(invoice_tax_id), '') is not null
      and nullif(btrim(invoice_address), '') is not null
    )
  );

-- Keep checkout activation conservative. At least one real payment rail must be enabled.
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop5_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop6_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
      and (bank_transfer_enabled = true or stripe_enabled = true or (pay_at_store_enabled = true and pickup_enabled = true))
    )
  );

-- ------------------------------------------------------------
-- PER-SKU WARRANTY OVERRIDE
-- ------------------------------------------------------------

alter table public.commerce_listings
  add column if not exists store_warranty_days integer,
  add column if not exists store_warranty_terms text;

alter table public.commerce_listings
  drop constraint if exists commerce_listings_store_warranty_days_check;
alter table public.commerce_listings
  add constraint commerce_listings_store_warranty_days_check
  check (store_warranty_days is null or store_warranty_days between 0 and 3650);

-- ------------------------------------------------------------
-- ORDER PAYMENT / INVOICE SNAPSHOT FIELDS
-- ------------------------------------------------------------

alter table public.commerce_orders
  add column if not exists payment_provider text not null default 'MANUAL',
  add column if not exists provider_checkout_session_id text,
  add column if not exists provider_payment_intent_id text,
  add column if not exists provider_payment_status text,
  add column if not exists provider_checkout_url text,
  add column if not exists provider_refund_id text,
  add column if not exists refund_status text,
  add column if not exists invoice_requested boolean not null default false,
  add column if not exists invoice_customer jsonb not null default '{}'::jsonb;

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_method_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_method_check
  check (payment_method in ('BANK_TRANSFER','PAY_AT_STORE','STRIPE'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_status_check
  check (payment_status in ('UNPAID','REVIEW','PAID','REFUND_PENDING','REFUNDED'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_fulfillment_status_check;
alter table public.commerce_orders
  add constraint commerce_orders_fulfillment_status_check
  check (fulfillment_status in ('UNFULFILLED','PACKING','SHIPPED','IN_TRANSIT','DELIVERED','PICKUP_READY','PICKED_UP','CANCELLED'));

alter table public.commerce_orders
  drop constraint if exists commerce_orders_payment_provider_check;
alter table public.commerce_orders
  add constraint commerce_orders_payment_provider_check
  check (payment_provider in ('MANUAL','STRIPE'));

create unique index if not exists commerce_orders_provider_session_uidx
  on public.commerce_orders(provider_checkout_session_id)
  where provider_checkout_session_id is not null;
create unique index if not exists commerce_orders_provider_payment_uidx
  on public.commerce_orders(provider_payment_intent_id)
  where provider_payment_intent_id is not null;

alter table public.commerce_order_items
  add column if not exists warranty_days integer not null default 0,
  add column if not exists warranty_terms text;

alter table public.commerce_order_items
  drop constraint if exists commerce_order_items_warranty_days_check;
alter table public.commerce_order_items
  add constraint commerce_order_items_warranty_days_check
  check (warranty_days between 0 and 3650);

-- ------------------------------------------------------------
-- PROVIDER PAYMENT LEDGER
-- ------------------------------------------------------------

create table if not exists public.commerce_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  provider text not null check (provider in ('STRIPE','MANUAL')),
  checkout_session_id text,
  payment_intent_id text,
  provider_status text,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, provider)
);

create table if not exists public.commerce_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  order_id uuid references public.commerce_orders(id) on delete set null,
  provider_payment_id text,
  amount_minor bigint,
  currency text,
  processed boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

create index if not exists commerce_payment_events_order_idx on public.commerce_payment_events(order_id, created_at desc);
create index if not exists commerce_payment_transactions_order_idx on public.commerce_payment_transactions(order_id);

-- ------------------------------------------------------------
-- SHIPPING + IMMUTABLE FULFILLMENT TIMELINE
-- ------------------------------------------------------------

create table if not exists public.commerce_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.commerce_orders(id) on delete cascade,
  carrier text,
  tracking_number text,
  tracking_url text,
  status text not null default 'PACKING'
    check (status in ('PACKING','SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_fulfillment_events (
  id bigserial primary key,
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commerce_fulfillment_events_order_idx
  on public.commerce_fulfillment_events(order_id, created_at asc);

-- ------------------------------------------------------------
-- IMMUTABLE DOCUMENT SNAPSHOTS
-- ------------------------------------------------------------

create sequence if not exists public.commerce_document_seq;

create table if not exists public.commerce_documents (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  document_number text not null unique,
  document_type text not null check (document_type in ('RECEIPT_ONLY','INVOICE_RECEIPT','VAT_TAX_INVOICE')),
  seller_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  totals_snapshot jsonb not null,
  items_snapshot jsonb not null,
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id, document_type)
);

-- ------------------------------------------------------------
-- WARRANTY CERTIFICATES + CLAIM TIMELINE
-- ------------------------------------------------------------

create sequence if not exists public.commerce_warranty_seq;

create table if not exists public.commerce_warranties (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  order_item_id uuid not null unique references public.commerce_order_items(id) on delete restrict,
  certificate_number text not null unique,
  sku text not null,
  title text not null,
  warranty_days integer not null check (warranty_days > 0),
  terms text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','VOID')),
  created_at timestamptz not null default now()
);

create table if not exists public.commerce_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  warranty_id uuid not null references public.commerce_warranties(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN','IN_REVIEW','APPROVED','REJECTED','RESOLVED','CANCELLED')),
  issue text not null,
  resolution text,
  opened_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists commerce_warranties_order_idx on public.commerce_warranties(order_id);
create index if not exists commerce_warranty_claims_warranty_idx on public.commerce_warranty_claims(warranty_id, opened_at desc);

-- ------------------------------------------------------------
-- SERVER-ONLY ACCESS BOUNDARY
-- ------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'commerce_payment_transactions','commerce_payment_events','commerce_shipments','commerce_fulfillment_events',
    'commerce_documents','commerce_warranties','commerce_warranty_claims'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- DOCUMENT / WARRANTY ISSUANCE HELPERS
-- ------------------------------------------------------------

create or replace function private.issue_commerce_document(target_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  s public.commerce_store_settings%rowtype;
  doc_type text;
  doc_id uuid;
  seller jsonb;
  customer jsonb;
  totals jsonb;
  items jsonb;
begin
  select * into o from public.commerce_orders where id = target_order_id;
  if o.id is null or o.payment_status <> 'PAID' then return null; end if;
  select * into s from public.commerce_store_settings where id = 1;

  doc_type := case
    when o.invoice_requested = true and s.document_mode in ('INVOICE_RECEIPT','VAT_TAX_INVOICE') then s.document_mode
    else 'RECEIPT_ONLY'
  end;

  select d.id into doc_id from public.commerce_documents d where d.order_id = o.id and d.document_type = doc_type;
  if doc_id is not null then return doc_id; end if;

  seller := jsonb_build_object(
    'merchantName', s.merchant_name,
    'legalName', s.legal_name,
    'sellerName', coalesce(s.invoice_seller_name, s.legal_name, s.merchant_name),
    'taxId', s.invoice_tax_id,
    'branchCode', s.invoice_branch_code,
    'address', s.invoice_address,
    'email', s.invoice_email,
    'siteUrl', s.site_url,
    'countryCode', s.country_code
  );

  customer := jsonb_build_object(
    'name', o.customer_name,
    'phone', o.customer_phone,
    'email', o.customer_email,
    'deliveryAddress', jsonb_strip_nulls(jsonb_build_object(
      'addressLine',o.address_line,'subdistrict',o.subdistrict,'district',o.district,'province',o.province,'postalCode',o.postal_code
    )),
    'invoiceRequested',o.invoice_requested,
    'invoice',coalesce(o.invoice_customer,'{}'::jsonb)
  );

  totals := jsonb_build_object('currency',o.currency,'subtotal',o.subtotal,'shippingAmount',o.shipping_amount,'total',o.total,'paidAt',o.paid_at);
  select coalesce(jsonb_agg(jsonb_build_object(
    'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'quantity',oi.quantity,'condition',oi.merchant_item_condition,
    'warrantyDays',oi.warranty_days,'warrantyTerms',oi.warranty_terms
  ) order by oi.created_at),'[]'::jsonb)
  into items from public.commerce_order_items oi where oi.order_id = o.id;

  insert into public.commerce_documents(order_id,document_number,document_type,seller_snapshot,customer_snapshot,totals_snapshot,items_snapshot)
  values (
    o.id,
    'AT-' || case when doc_type='VAT_TAX_INVOICE' then 'TAX' when doc_type='INVOICE_RECEIPT' then 'INV' else 'RCP' end || '-' ||
      to_char(now() at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_document_seq')::text,6,'0'),
    doc_type,seller,customer,totals,items
  )
  returning id into doc_id;
  return doc_id;
end;
$$;

revoke all on function private.issue_commerce_document(uuid) from public, anon, authenticated;

create or replace function private.issue_commerce_warranties(target_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  item record;
  start_at timestamptz;
  inserted_count integer := 0;
begin
  select * into o from public.commerce_orders where id = target_order_id;
  if o.id is null or o.order_status <> 'COMPLETED' or o.payment_status <> 'PAID' then return 0; end if;
  start_at := coalesce(o.completed_at, now());
  for item in
    select oi.* from public.commerce_order_items oi where oi.order_id=o.id and oi.warranty_days > 0 order by oi.created_at
  loop
    insert into public.commerce_warranties(order_id,order_item_id,certificate_number,sku,title,warranty_days,terms,starts_at,ends_at)
    values (
      o.id,item.id,
      'AT-WAR-' || to_char(start_at at time zone 'Asia/Bangkok','YYMMDD') || '-' || lpad(nextval('public.commerce_warranty_seq')::text,6,'0'),
      item.sku,item.title,item.warranty_days,item.warranty_terms,start_at,start_at + make_interval(days => item.warranty_days)
    ) on conflict (order_item_id) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function private.issue_commerce_warranties(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- SHARED PAID TRANSITION
-- ------------------------------------------------------------

create or replace function private.mark_commerce_order_paid(
  target_order_id uuid,
  actor_id uuid default null,
  provider_name text default 'MANUAL',
  provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status = 'PAID' then
    return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status);
  end if;
  if target.payment_status not in ('UNPAID','REVIEW') or target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if target.reservation_expires_at <= now() then raise exception 'RESERVATION_EXPIRED'; end if;

  for item in select product_id from public.commerce_order_items where order_id=target.id order by product_id loop
    perform 1 from public.products where id=item.product_id for update;
    update public.products set status='sold', updated_by=actor_id
     where id=item.product_id and status='reserved'
       and exists(select 1 from public.commerce_reservations r where r.product_id=item.product_id and r.order_id=target.id);
    if not found then raise exception 'RESERVED_PRODUCT_STATE_MISMATCH'; end if;
  end loop;

  delete from public.commerce_reservations where order_id=target.id;
  update public.commerce_orders
     set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=coalesce(paid_at,now()),
         payment_provider=upper(coalesce(provider_name,'MANUAL')),
         provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),
         provider_payment_status='PAID'
   where id=target.id
   returning * into target;

  insert into public.commerce_payment_transactions(order_id,provider,payment_intent_id,provider_status,amount,currency,paid_at)
  values (target.id,upper(coalesce(provider_name,'MANUAL')),provider_payment_id,'PAID',target.total,target.currency,target.paid_at)
  on conflict (order_id,provider) do update
    set payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),
        provider_status='PAID',paid_at=coalesce(public.commerce_payment_transactions.paid_at,excluded.paid_at),updated_at=now();

  perform private.issue_commerce_document(target.id);
  insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
  values(target.id,'PAYMENT_CONFIRMED',actor_id,jsonb_build_object('provider',upper(coalesce(provider_name,'MANUAL'))));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function private.mark_commerce_order_paid(uuid,uuid,text,text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- SHOP-6 ATOMIC CHECKOUT (REPLACES SHOP-5 VERSION)
-- ------------------------------------------------------------

create or replace function public.create_commerce_order(checkout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.commerce_store_settings%rowtype;
  existing public.commerce_orders%rowtype;
  new_order public.commerce_orders%rowtype;
  requested_skus text[];
  locked_product record;
  item_count integer;
  validated_count integer := 0;
  subtotal_amount numeric(12,2) := 0;
  shipping_amount_value numeric(12,2) := 0;
  total_amount numeric(12,2) := 0;
  expires_at_value timestamptz;
  idem uuid;
  payment_method_value text;
  delivery_method_value text;
  customer_name_value text;
  customer_phone_value text;
  customer_email_value text;
  stale record;
  invoice_requested_value boolean := false;
  invoice_customer_value jsonb := '{}'::jsonb;
begin
  select * into settings from public.commerce_store_settings where id=1 for share;
  if settings.id is null or settings.purchase_enabled is not true then raise exception 'CHECKOUT_DISABLED'; end if;

  begin idem := (checkout->>'idempotencyKey')::uuid; exception when others then raise exception 'INVALID_IDEMPOTENCY_KEY'; end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(idem::text,0));
  select * into existing from public.commerce_orders where idempotency_key=idem;
  if existing.id is not null then
    return jsonb_build_object('orderId',existing.id,'publicToken',existing.public_token,'orderNumber',existing.order_number,
      'orderStatus',existing.order_status,'paymentStatus',existing.payment_status,'reservationExpiresAt',existing.reservation_expires_at,
      'subtotal',existing.subtotal,'shippingAmount',existing.shipping_amount,'total',existing.total,'currency',existing.currency,
      'paymentMethod',existing.payment_method,'providerCheckoutUrl',existing.provider_checkout_url);
  end if;

  select array_agg(distinct upper(btrim(v)) order by upper(btrim(v))) into requested_skus
    from jsonb_array_elements_text(coalesce(checkout->'skus','[]'::jsonb)) t(v) where btrim(v)<>'';
  item_count := coalesce(cardinality(requested_skus),0);
  if item_count<1 or item_count>10 then raise exception 'INVALID_CART_SIZE'; end if;

  customer_name_value := left(btrim(coalesce(checkout->>'customerName','')),120);
  customer_phone_value := left(regexp_replace(coalesce(checkout->>'customerPhone',''),'[^0-9+]','','g'),30);
  customer_email_value := nullif(left(btrim(coalesce(checkout->>'customerEmail','')),180),'');
  if char_length(customer_name_value)<2 then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;
  if char_length(customer_phone_value)<8 then raise exception 'CUSTOMER_PHONE_REQUIRED'; end if;

  payment_method_value := upper(coalesce(checkout->>'paymentMethod','BANK_TRANSFER'));
  delivery_method_value := upper(coalesce(checkout->>'deliveryMethod','SHIPPING'));
  if payment_method_value not in ('BANK_TRANSFER','PAY_AT_STORE','STRIPE') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if delivery_method_value not in ('SHIPPING','PICKUP') then raise exception 'INVALID_DELIVERY_METHOD'; end if;
  if payment_method_value='BANK_TRANSFER' and settings.bank_transfer_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='STRIPE' and settings.stripe_enabled is not true then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if payment_method_value='PAY_AT_STORE' and (settings.pay_at_store_enabled is not true or settings.pickup_enabled is not true or delivery_method_value<>'PICKUP') then raise exception 'PAYMENT_METHOD_DISABLED'; end if;
  if delivery_method_value='PICKUP' and settings.pickup_enabled is not true then raise exception 'PICKUP_DISABLED'; end if;
  if delivery_method_value='SHIPPING' then
    if settings.shipping_enabled is not true then raise exception 'SHIPPING_DISABLED'; end if;
    if nullif(btrim(coalesce(checkout->>'addressLine','')),'') is null
       or nullif(btrim(coalesce(checkout->>'district','')),'') is null
       or nullif(btrim(coalesce(checkout->>'province','')),'') is null
       or nullif(btrim(coalesce(checkout->>'postalCode','')),'') is null then raise exception 'SHIPPING_ADDRESS_REQUIRED'; end if;
    shipping_amount_value := coalesce(settings.shipping_rate,0);
  end if;

  invoice_requested_value := lower(coalesce(checkout->>'invoiceRequested','false')) in ('true','1','yes','on');
  if invoice_requested_value then
    invoice_customer_value := jsonb_strip_nulls(jsonb_build_object(
      'name',nullif(left(btrim(coalesce(checkout->>'invoiceName','')),180),''),
      'taxId',nullif(left(regexp_replace(coalesce(checkout->>'invoiceTaxId',''),'[^0-9]','','g'),20),''),
      'branchCode',nullif(left(btrim(coalesce(checkout->>'invoiceBranchCode','')),20),''),
      'address',nullif(left(btrim(coalesce(checkout->>'invoiceAddress','')),500),''),
      'email',nullif(left(btrim(coalesce(checkout->>'invoiceEmail','')),180),'')
    ));
    if nullif(invoice_customer_value->>'name','') is null or nullif(invoice_customer_value->>'address','') is null then raise exception 'INVOICE_DETAILS_REQUIRED'; end if;
  end if;

  if (select count(*) from public.products p where p.sku=any(requested_skus))<>item_count then raise exception 'PRODUCT_NOT_FOUND'; end if;

  for stale in
    select distinct r.order_id from public.commerce_reservations r join public.products p on p.id=r.product_id
     where p.sku=any(requested_skus) and r.expires_at<=now()
  loop
    perform private.release_commerce_order_inventory(stale.order_id,'EXPIRED');
  end loop;

  for locked_product in
    select p.id,p.sku,p.title,p.status,p.price,coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition,
           coalesce(cl.store_warranty_days,settings.default_warranty_days,0) as warranty_days,
           coalesce(nullif(cl.store_warranty_terms,''),nullif(settings.default_warranty_terms,'')) as warranty_terms
      from public.products p
      join public.product_publications pp on pp.product_id=p.id and pp.channel='website' and pp.status='published'
      left join public.commerce_listings cl on cl.product_id=p.id
     where p.sku=any(requested_skus)
     order by p.sku for update of p
  loop
    if locked_product.status<>'published' then raise exception 'PRODUCT_UNAVAILABLE:%',locked_product.sku; end if;
    if locked_product.price is null or locked_product.price<=0 then raise exception 'PRODUCT_PRICE_INVALID:%',locked_product.sku; end if;
    if exists(select 1 from public.commerce_reservations r where r.product_id=locked_product.id) then raise exception 'PRODUCT_RESERVED:%',locked_product.sku; end if;
    validated_count:=validated_count+1;
    subtotal_amount:=subtotal_amount+locked_product.price;
  end loop;

  if validated_count<>item_count then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if subtotal_amount<=0 then raise exception 'EMPTY_CART'; end if;
  total_amount:=subtotal_amount+shipping_amount_value;
  expires_at_value:=now()+make_interval(mins=>settings.reservation_minutes);

  insert into public.commerce_orders(
    idempotency_key,order_number,payment_method,payment_provider,delivery_method,
    customer_name,customer_phone,customer_email,address_line,subdistrict,district,province,postal_code,customer_note,
    currency,subtotal,shipping_amount,total,reservation_expires_at,invoice_requested,invoice_customer
  ) values (
    idem,'ATSO-'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')||'-'||lpad(nextval('public.commerce_order_seq')::text,6,'0'),
    payment_method_value,case when payment_method_value='STRIPE' then 'STRIPE' else 'MANUAL' end,delivery_method_value,
    customer_name_value,customer_phone_value,customer_email_value,
    nullif(left(btrim(coalesce(checkout->>'addressLine','')),250),''),nullif(left(btrim(coalesce(checkout->>'subdistrict','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'district','')),120),''),nullif(left(btrim(coalesce(checkout->>'province','')),120),''),
    nullif(left(btrim(coalesce(checkout->>'postalCode','')),20),''),nullif(left(btrim(coalesce(checkout->>'note','')),500),''),
    coalesce(settings.currency,'THB'),subtotal_amount,shipping_amount_value,total_amount,expires_at_value,invoice_requested_value,invoice_customer_value
  ) returning * into new_order;

  for locked_product in
    select p.id,p.sku,p.title,p.price,coalesce(cl.merchant_item_condition,'USED') as merchant_item_condition,
           coalesce(cl.store_warranty_days,settings.default_warranty_days,0) as warranty_days,
           coalesce(nullif(cl.store_warranty_terms,''),nullif(settings.default_warranty_terms,'')) as warranty_terms
      from public.products p left join public.commerce_listings cl on cl.product_id=p.id
     where p.sku=any(requested_skus) order by p.sku
  loop
    insert into public.commerce_order_items(order_id,product_id,sku,title,unit_price,merchant_item_condition,warranty_days,warranty_terms)
    values(new_order.id,locked_product.id,locked_product.sku,locked_product.title,locked_product.price,locked_product.merchant_item_condition,locked_product.warranty_days,locked_product.warranty_terms);
    insert into public.commerce_reservations(product_id,order_id,expires_at) values(locked_product.id,new_order.id,expires_at_value);
    update public.products set status='reserved',updated_by=null where id=locked_product.id and status='published';
    if not found then raise exception 'PRODUCT_RESERVATION_RACE:%',locked_product.sku; end if;
  end loop;

  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(new_order.id,'ORDER_RESERVED',jsonb_build_object('paymentMethod',payment_method_value,'deliveryMethod',delivery_method_value));

  return jsonb_build_object('orderId',new_order.id,'publicToken',new_order.public_token,'orderNumber',new_order.order_number,
    'orderStatus',new_order.order_status,'paymentStatus',new_order.payment_status,'reservationExpiresAt',new_order.reservation_expires_at,
    'subtotal',new_order.subtotal,'shippingAmount',new_order.shipping_amount,'total',new_order.total,'currency',new_order.currency,
    'paymentMethod',new_order.payment_method);
end;
$$;

revoke all on function public.create_commerce_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_commerce_order(jsonb) to service_role;

-- ------------------------------------------------------------
-- GATEWAY SESSION / WEBHOOK RPCS
-- ------------------------------------------------------------

create or replace function public.attach_commerce_gateway_checkout(
  target_order_id uuid,
  provider_name text,
  checkout_session_id text,
  checkout_url text,
  provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.commerce_orders%rowtype;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_method<>'STRIPE' or upper(provider_name)<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;
  if o.payment_status<>'UNPAID' then raise exception 'ORDER_NOT_PAYABLE'; end if;
  update public.commerce_orders set payment_provider='STRIPE',provider_checkout_session_id=checkout_session_id,
    provider_checkout_url=checkout_url,provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),provider_payment_status='CHECKOUT_OPEN'
    where id=o.id returning * into o;
  insert into public.commerce_payment_transactions(order_id,provider,checkout_session_id,payment_intent_id,provider_status,amount,currency)
  values(o.id,'STRIPE',checkout_session_id,provider_payment_id,'CHECKOUT_OPEN',o.total,o.currency)
  on conflict(order_id,provider) do update set checkout_session_id=excluded.checkout_session_id,
    payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),provider_status='CHECKOUT_OPEN',updated_at=now();
  return jsonb_build_object('orderId',o.id,'publicToken',o.public_token,'checkoutUrl',o.provider_checkout_url,'checkoutSessionId',o.provider_checkout_session_id);
end;
$$;

revoke all on function public.attach_commerce_gateway_checkout(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.attach_commerce_gateway_checkout(uuid,text,text,text,text) to service_role;

create or replace function public.cancel_commerce_gateway_order(target_order_id uuid, reason text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare released integer;
begin
  released := private.release_commerce_order_inventory(target_order_id,'CANCELLED');
  update public.commerce_orders set provider_payment_status='CHECKOUT_CREATE_FAILED',provider_checkout_url=null where id=target_order_id and payment_status='UNPAID';
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(target_order_id,'GATEWAY_CHECKOUT_CANCELLED',jsonb_build_object('reason',left(coalesce(reason,''),300)));
  return released;
end;
$$;

revoke all on function public.cancel_commerce_gateway_order(uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_commerce_gateway_order(uuid,text) to service_role;

create or replace function public.mark_commerce_gateway_refund_pending(target_order_id uuid, provider_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.commerce_orders%rowtype;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders set payment_status='REFUND_PENDING',provider_refund_id=provider_refund_id,refund_status='PENDING' where id=o.id returning * into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

create or replace function public.process_gateway_payment_event(
  provider_name text,
  provider_event_id text,
  normalized_event text,
  target_order_id uuid default null,
  provider_payment_id text default null,
  amount_minor bigint default null,
  currency_code text default null,
  event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_event_id uuid;
  o public.commerce_orders%rowtype;
  expected_minor bigint;
  action text := upper(normalized_event);
  item record;
begin
  insert into public.commerce_payment_events(provider,provider_event_id,event_type,order_id,provider_payment_id,amount_minor,currency,payload)
  values(upper(provider_name),provider_event_id,action,target_order_id,provider_payment_id,amount_minor,upper(currency_code),coalesce(event_payload,'{}'::jsonb))
  on conflict(provider,provider_event_id) do nothing returning id into inserted_event_id;
  if inserted_event_id is null then return jsonb_build_object('duplicate',true,'providerEventId',provider_event_id); end if;

  if target_order_id is not null then select * into o from public.commerce_orders where id=target_order_id for update;
  elsif provider_payment_id is not null then select * into o from public.commerce_orders where provider_payment_intent_id=provider_payment_id for update;
  end if;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or upper(provider_name)<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;

  if provider_payment_id is not null and o.provider_payment_intent_id is null then
    update public.commerce_orders set provider_payment_intent_id=provider_payment_id where id=o.id returning * into o;
  end if;

  if action='PAYMENT_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if amount_minor is null or amount_minor<>expected_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    if upper(coalesce(currency_code,''))<>upper(o.currency) then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
    perform private.mark_commerce_order_paid(o.id,null,'STRIPE',provider_payment_id);
    update public.commerce_orders set provider_payment_status='PAID',provider_checkout_url=null where id=o.id;
    update public.commerce_payment_transactions set provider_status='PAID',payment_intent_id=coalesce(provider_payment_id,payment_intent_id),paid_at=coalesce(paid_at,now()),updated_at=now()
      where order_id=o.id and provider='STRIPE';
  elsif action='PAYMENT_FAILED' then
    update public.commerce_orders set provider_payment_status='FAILED' where id=o.id and payment_status='UNPAID';
    update public.commerce_payment_transactions set provider_status='FAILED',updated_at=now() where order_id=o.id and provider='STRIPE';
  elsif action='CHECKOUT_EXPIRED' then
    if o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'EXPIRED'); end if;
    update public.commerce_orders set provider_payment_status='EXPIRED',provider_checkout_url=null where id=o.id;
    update public.commerce_payment_transactions set provider_status='EXPIRED',updated_at=now() where order_id=o.id and provider='STRIPE';
  elsif action='REFUND_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if amount_minor is not null and amount_minor<>expected_minor then raise exception 'PARTIAL_REFUND_NOT_SUPPORTED'; end if;
    if o.payment_status not in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id=o.id order by product_id loop
      perform 1 from public.products where id=item.product_id for update;
      update public.products set status='returned',updated_by=null where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='SUCCEEDED',provider_payment_status='REFUNDED' where id=o.id;
    update public.commerce_payment_transactions set provider_status='REFUNDED',refunded_at=now(),updated_at=now() where order_id=o.id and provider='STRIPE';
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_CONFIRMED',jsonb_build_object('provider','STRIPE'));
  elsif action='REFUND_FAILED' then
    update public.commerce_orders set payment_status=case when payment_status='REFUND_PENDING' then 'PAID' else payment_status end,refund_status='FAILED' where id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_FAILED',jsonb_build_object('provider','STRIPE'));
  else
    raise exception 'UNSUPPORTED_GATEWAY_EVENT';
  end if;

  update public.commerce_payment_events set processed=true,processed_at=now(),order_id=o.id where id=inserted_event_id;
  select * into o from public.commerce_orders where id=o.id;
  return jsonb_build_object('duplicate',false,'orderId',o.id,'orderNumber',o.order_number,'paymentStatus',o.payment_status,'orderStatus',o.order_status,'fulfillmentStatus',o.fulfillment_status);
end;
$$;

revoke all on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER ACTIONS — PAYMENT, SHIPPING, TRACKING, WARRANTY
-- ------------------------------------------------------------

create or replace function public.admin_commerce_order_action(
  target_order_id uuid,
  action_name text,
  actor_id uuid,
  action_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
  action text := upper(btrim(action_name));
  carrier_value text;
  tracking_value text;
  tracking_url_value text;
  shipment_status text;
  claim_warranty_id uuid;
  claim_issue text;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  if action='CONFIRM_PAYMENT' then
    if target.payment_provider='STRIPE' or target.payment_method='STRIPE' then raise exception 'GATEWAY_WEBHOOK_REQUIRED'; end if;
    perform private.mark_commerce_order_paid(target.id,actor_id,'MANUAL',null);
  elsif action='CANCEL' then
    if target.payment_status in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRES_REFUND'; end if;
    if target.order_status not in ('CANCELLED','EXPIRED') then perform private.release_commerce_order_inventory(target.id,'CANCELLED'); end if;
  elsif action='MARK_PACKING' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING',fulfillment_status='PACKING' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'PACKING',actor_id);
  elsif action='MARK_SHIPPED' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    carrier_value:=nullif(left(btrim(coalesce(action_data->>'trackingCarrier','')),100),'');
    tracking_value:=nullif(left(btrim(coalesce(action_data->>'trackingNumber','')),120),'');
    tracking_url_value:=nullif(left(btrim(coalesce(action_data->>'trackingUrl','')),500),'');
    if tracking_value is null then raise exception 'TRACKING_REQUIRED'; end if;
    update public.commerce_orders set order_status='SHIPPED',fulfillment_status='SHIPPED',shipped_at=coalesce(shipped_at,now()),tracking_carrier=carrier_value,tracking_number=tracking_value where id=target.id;
    insert into public.commerce_shipments(order_id,carrier,tracking_number,tracking_url,status,shipped_at)
    values(target.id,carrier_value,tracking_value,tracking_url_value,'SHIPPED',now())
    on conflict(order_id) do update set carrier=excluded.carrier,tracking_number=excluded.tracking_number,tracking_url=excluded.tracking_url,status='SHIPPED',shipped_at=coalesce(public.commerce_shipments.shipped_at,excluded.shipped_at),updated_at=now();
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata) values(target.id,'SHIPPED',actor_id,jsonb_build_object('carrier',carrier_value,'trackingNumber',tracking_value,'trackingUrl',tracking_url_value));
  elsif action='MARK_IN_TRANSIT' then
    if target.payment_status<>'PAID' or target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='SHIPPED',fulfillment_status='IN_TRANSIT' where id=target.id;
    update public.commerce_shipments set status='IN_TRANSIT',updated_at=now() where order_id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'IN_TRANSIT',actor_id);
  elsif action='MARK_DELIVERED' then
    if target.payment_status<>'PAID' or target.delivery_method<>'SHIPPING' then raise exception 'SHIPPING_ORDER_REQUIRED'; end if;
    if target.fulfillment_status not in ('SHIPPED','IN_TRANSIT') then raise exception 'SHIPMENT_NOT_READY'; end if;
    update public.commerce_orders set order_status='COMPLETED',fulfillment_status='DELIVERED',completed_at=coalesce(completed_at,now()) where id=target.id;
    update public.commerce_shipments set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),updated_at=now() where order_id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'DELIVERED',actor_id);
    perform private.issue_commerce_warranties(target.id);
  elsif action='MARK_PICKUP_READY' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method<>'PICKUP' then raise exception 'PICKUP_ORDER_REQUIRED'; end if;
    update public.commerce_orders set order_status='PROCESSING',fulfillment_status='PICKUP_READY' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'PICKUP_READY',actor_id);
  elsif action='COMPLETE' then
    if target.payment_status<>'PAID' then raise exception 'PAYMENT_REQUIRED'; end if;
    if target.delivery_method='SHIPPING' then
      if target.fulfillment_status not in ('SHIPPED','IN_TRANSIT') then raise exception 'SHIPMENT_NOT_READY'; end if;
      update public.commerce_orders set order_status='COMPLETED',fulfillment_status='DELIVERED',completed_at=coalesce(completed_at,now()) where id=target.id;
      update public.commerce_shipments set status='DELIVERED',delivered_at=coalesce(delivered_at,now()),updated_at=now() where order_id=target.id;
    else
      if target.fulfillment_status<>'PICKUP_READY' then raise exception 'PICKUP_NOT_READY'; end if;
      update public.commerce_orders set order_status='COMPLETED',fulfillment_status='PICKED_UP',completed_at=coalesce(completed_at,now()) where id=target.id;
    end if;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id) values(target.id,'COMPLETED',actor_id);
    perform private.issue_commerce_warranties(target.id);
  elsif action='REFUND' then
    if target.payment_provider='STRIPE' or target.payment_method='STRIPE' then raise exception 'GATEWAY_REFUND_REQUIRED'; end if;
    if target.payment_status<>'PAID' then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select product_id from public.commerce_order_items where order_id=target.id order by product_id loop
      perform 1 from public.products where id=item.product_id for update;
      update public.products set status='returned',updated_by=actor_id where id=item.product_id and status='sold';
    end loop;
    update public.commerce_orders set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='MANUAL_CONFIRMED' where id=target.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata) values(target.id,'REFUND_CONFIRMED',actor_id,jsonb_build_object('provider','MANUAL'));
  elsif action='OPEN_WARRANTY_CLAIM' then
    begin claim_warranty_id := (action_data->>'warrantyId')::uuid; exception when others then raise exception 'INVALID_WARRANTY_ID'; end;
    claim_issue := nullif(left(btrim(coalesce(action_data->>'issue','')),1000),'');
    if claim_issue is null then raise exception 'WARRANTY_ISSUE_REQUIRED'; end if;
    if not exists(select 1 from public.commerce_warranties w where w.id=claim_warranty_id and w.order_id=target.id) then raise exception 'WARRANTY_NOT_FOUND'; end if;
    insert into public.commerce_warranty_claims(warranty_id,issue,opened_by) values(claim_warranty_id,claim_issue,actor_id);
  else
    raise exception 'INVALID_ORDER_ACTION';
  end if;

  select * into target from public.commerce_orders where id=target_order_id;
  insert into public.activity_logs(actor_id,action,metadata)
  values(actor_id,'commerce_order_'||lower(action),jsonb_build_object('orderId',target.id,'orderNumber',target.order_number));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'orderStatus',target.order_status,'paymentStatus',target.payment_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) to service_role;

-- ------------------------------------------------------------
-- STAFF ORDER VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_order_admin_v
with (security_invoker = true)
as
select
  -- SHOP-5 contract: keep every existing column in the same position.
  o.id,o.order_number,o.order_status,o.payment_status,o.fulfillment_status,o.payment_method,o.delivery_method,
  o.customer_name,o.customer_phone,o.customer_email,o.address_line,o.subdistrict,o.district,o.province,o.postal_code,o.customer_note,
  o.currency,o.subtotal,o.shipping_amount,o.total,o.reservation_expires_at,o.payment_reference,o.payment_notified_at,o.paid_at,
  o.tracking_carrier,o.tracking_number,o.shipped_at,o.completed_at,o.cancelled_at,o.expired_at,o.refunded_at,o.created_at,o.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id',oi.id,'productId',oi.product_id,'sku',oi.sku,'title',oi.title,'unitPrice',oi.unit_price,'condition',oi.merchant_item_condition,
    'warrantyDays',oi.warranty_days,'warrantyTerms',oi.warranty_terms
  ) order by oi.created_at) from public.commerce_order_items oi where oi.order_id=o.id),'[]'::jsonb) as items,
  -- SHOP-6 additions: append only so CREATE OR REPLACE VIEW remains compatible.
  o.payment_provider,
  o.provider_checkout_session_id,o.provider_payment_intent_id,o.provider_payment_status,o.provider_refund_id,o.refund_status,
  o.invoice_requested,o.invoice_customer,
  sh.tracking_url,sh.status as shipment_status,sh.delivered_at,
  coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'publicToken',w.public_token,'certificateNumber',w.certificate_number,'sku',w.sku,'title',w.title,'status',w.status,'startsAt',w.starts_at,'endsAt',w.ends_at) order by w.created_at) from public.commerce_warranties w where w.order_id=o.id),'[]'::jsonb) as warranties,
  (select jsonb_build_object('publicToken',d.public_token,'documentNumber',d.document_number,'documentType',d.document_type,'issuedAt',d.issued_at) from public.commerce_documents d where d.order_id=o.id and d.voided_at is null order by d.issued_at desc limit 1) as document
from public.commerce_orders o
left join public.commerce_shipments sh on sh.order_id=o.id;

revoke all on public.commerce_order_admin_v from anon, authenticated;
grant select on public.commerce_order_admin_v to service_role;

-- ------------------------------------------------------------
-- COMMERCE LISTING EDITOR VIEW WITH WARRANTY OVERRIDE
-- ------------------------------------------------------------

create or replace view public.commerce_listing_editor_v
with (security_invoker = true)
as
select
  -- SHOP-4 contract: preserve the original column order through updated_at.
  p.id as product_id,p.sku,p.title,p.status as product_status,cl.id as listing_id,cl.slug,
  '/p/'||cl.slug||'-'||lower(p.sku)||'/' as canonical_path,
  cl.category_id,c.name_th as category_name,cl.brand_id,b.name as brand_name,cl.series_id,s.name as series_name,
  cl.model_id,m.model_name,cl.seo_title,cl.seo_description,cl.index_policy,cl.merchant_enabled,cl.merchant_item_condition,
  cl.google_product_category,cl.gtin,cl.mpn,
  coalesce(r.website_status,'not_published') as website_status,coalesce(r.data_ready,false) as data_ready,
  coalesce(r.merchant_activation_ready,false) as merchant_activation_ready,coalesce(r.blockers,array[]::text[]) as blockers,cl.updated_at,
  -- SHOP-6 additions: append only.
  cl.store_warranty_days,cl.store_warranty_terms
from public.products p
join public.commerce_listings cl on cl.product_id=p.id
left join public.commerce_categories c on c.id=cl.category_id
left join public.commerce_brands b on b.id=cl.brand_id
left join public.commerce_series s on s.id=cl.series_id
left join public.commerce_models m on m.id=cl.model_id
left join public.commerce_merchant_readiness_v r on r.product_id=p.id;

revoke all on public.commerce_listing_editor_v from anon;
grant select on public.commerce_listing_editor_v to authenticated;
grant select on public.commerce_listing_editor_v to service_role;

-- ------------------------------------------------------------
-- PUBLIC STORE SETTINGS PROJECTION (SERVER-ONLY VIEW, NO SECRETS)
-- ------------------------------------------------------------

create or replace view public.commerce_public_store_settings_v
with (security_invoker = true)
as
select
  -- SHOP-3 contract, then SHOP-5 columns, then SHOP-6 columns. Append only.
  merchant_name,legal_name,site_url,currency,country_code,purchase_enabled,
  shipping_enabled,shipping_country,shipping_rate,handling_min_days,handling_max_days,transit_min_days,transit_max_days,shipping_policy_url,
  return_policy_enabled,return_policy_category,return_days,return_method,return_fees,return_policy_url,warranty_policy_url,
  updated_at,
  reservation_minutes,bank_transfer_enabled,pay_at_store_enabled,pickup_enabled,checkout_terms_url,checkout_turnstile_enabled,turnstile_site_key,
  stripe_enabled,stripe_promptpay_enabled,document_mode,default_warranty_days
from public.commerce_store_settings where id=1;

revoke all on public.commerce_public_store_settings_v from anon, authenticated;
grant select on public.commerce_public_store_settings_v to service_role;

-- ------------------------------------------------------------
-- UPDATE TOUCH TRIGGERS FOR NEW MUTABLE TABLES
-- ------------------------------------------------------------

drop trigger if exists commerce_payment_transactions_touch on public.commerce_payment_transactions;
create trigger commerce_payment_transactions_touch before update on public.commerce_payment_transactions
for each row execute procedure public.touch_commerce_order();

drop trigger if exists commerce_shipments_touch on public.commerce_shipments;
create trigger commerce_shipments_touch before update on public.commerce_shipments
for each row execute procedure public.touch_commerce_order();

drop trigger if exists commerce_warranty_claims_touch on public.commerce_warranty_claims;
create trigger commerce_warranty_claims_touch before update on public.commerce_warranty_claims
for each row execute procedure public.touch_commerce_order();

-- Service role owns the server-only RPC surface.
grant usage, select on sequence public.commerce_document_seq to service_role;
grant usage, select on sequence public.commerce_warranty_seq to service_role;
-- ============================================================================
-- END SOURCE: supabase/shop_6.sql
-- ============================================================================


-- AMPHON SHOP — SHOP-6.2 Payment & Fulfillment E2E Acceptance Gate
-- Run after supabase/shop_6.sql. Safe to re-run.
--
-- Goals:
-- 1) Keep public purchase disabled until a real Stripe TEST provider E2E has passed.
-- 2) Allow isolated AT-TST-* checkout fixtures without exposing public checkout.
-- 3) Invalidate acceptance automatically if payment/fulfillment-critical settings change.
-- 4) Make full-refund warranty/claim state deterministic.
-- 5) Never store Stripe/Supabase secrets in PostgreSQL.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ------------------------------------------------------------
-- ACCEPTANCE STATE
-- ------------------------------------------------------------

alter table public.commerce_store_settings
  add column if not exists shop62_acceptance_version text,
  add column if not exists shop62_accepted_at timestamptz,
  add column if not exists shop62_acceptance_evidence jsonb not null default '{}'::jsonb,
  add column if not exists shop62_test_token_hash text,
  add column if not exists shop62_test_token_expires_at timestamptz,
  add column if not exists shop62_last_invalidated_at timestamptz,
  add column if not exists shop62_last_invalidated_reason text;

-- Ensure an older enabled checkout cannot stay open merely because SHOP-6.2 was added.
update public.commerce_store_settings
   set purchase_enabled = false
 where id = 1
   and purchase_enabled = true
   and coalesce(shop62_acceptance_version, '') <> 'SHOP-6.2';

create or replace function private.shop62_actor_is_service_or_postgres()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_user = 'postgres' or coalesce(auth.role(), '') = 'service_role';
$$;

revoke all on function private.shop62_actor_is_service_or_postgres() from public, anon, authenticated;

-- A small deterministic trigger is safer than relying on UI discipline. Any material
-- checkout/payment/fulfillment config change revokes the provider acceptance evidence.
create or replace function private.invalidate_shop62_acceptance_on_critical_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('app.shop62_test_mode', true), '') = 'on' then
    return new;
  end if;

  if
    new.site_url is distinct from old.site_url
    or new.currency is distinct from old.currency
    or new.shipping_enabled is distinct from old.shipping_enabled
    or new.shipping_country is distinct from old.shipping_country
    or new.shipping_rate is distinct from old.shipping_rate
    or new.handling_min_days is distinct from old.handling_min_days
    or new.handling_max_days is distinct from old.handling_max_days
    or new.transit_min_days is distinct from old.transit_min_days
    or new.transit_max_days is distinct from old.transit_max_days
    or new.return_policy_enabled is distinct from old.return_policy_enabled
    or new.return_policy_category is distinct from old.return_policy_category
    or new.return_days is distinct from old.return_days
    or new.return_method is distinct from old.return_method
    or new.return_fees is distinct from old.return_fees
    or new.reservation_minutes is distinct from old.reservation_minutes
    or new.bank_transfer_enabled is distinct from old.bank_transfer_enabled
    or new.pay_at_store_enabled is distinct from old.pay_at_store_enabled
    or new.pickup_enabled is distinct from old.pickup_enabled
    or new.checkout_turnstile_enabled is distinct from old.checkout_turnstile_enabled
    or new.turnstile_site_key is distinct from old.turnstile_site_key
    or new.stripe_enabled is distinct from old.stripe_enabled
    or new.stripe_promptpay_enabled is distinct from old.stripe_promptpay_enabled
    or new.document_mode is distinct from old.document_mode
    or new.default_warranty_days is distinct from old.default_warranty_days
    or new.default_warranty_terms is distinct from old.default_warranty_terms
  then
    new.purchase_enabled := false;
    new.shop62_acceptance_version := null;
    new.shop62_accepted_at := null;
    new.shop62_acceptance_evidence := '{}'::jsonb;
    new.shop62_last_invalidated_at := now();
    new.shop62_last_invalidated_reason := 'PAYMENT_OR_FULFILLMENT_CONFIG_CHANGED';
  end if;

  return new;
end;
$$;

revoke all on function private.invalidate_shop62_acceptance_on_critical_settings() from public, anon, authenticated;

drop trigger if exists commerce_store_settings_shop62_invalidate on public.commerce_store_settings;
create trigger commerce_store_settings_shop62_invalidate
before update on public.commerce_store_settings
for each row execute procedure private.invalidate_shop62_acceptance_on_critical_settings();

-- Replace the SHOP-6 activation guard with the stronger SHOP-6.2 provider gate.
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop6_purchase_ready_check;
alter table public.commerce_store_settings
  drop constraint if exists commerce_store_settings_shop62_purchase_ready_check;
alter table public.commerce_store_settings
  add constraint commerce_store_settings_shop62_purchase_ready_check
  check (
    purchase_enabled = false
    or (
      shipping_enabled = true
      and return_policy_enabled = true
      and checkout_turnstile_enabled = true
      and nullif(btrim(turnstile_site_key), '') is not null
      and nullif(btrim(site_url), '') is not null
      and (bank_transfer_enabled = true or stripe_enabled = true or (pay_at_store_enabled = true and pickup_enabled = true))
      and shop62_acceptance_version = 'SHOP-6.2'
      and shop62_accepted_at is not null
      and coalesce(shop62_acceptance_evidence->>'provider', '') = 'STRIPE'
      and coalesce(shop62_acceptance_evidence->>'mode', '') = 'test'
      and coalesce(shop62_acceptance_evidence->>'card', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'signedWebhook', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'duplicateEvent', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'amountMismatch', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'currencyMismatch', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'reservationExpiry', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'shippingLifecycle', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'pickupLifecycle', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'documentSnapshot', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'warrantySnapshot', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'refundReturned', '') = 'PASS'
      and coalesce(shop62_acceptance_evidence->>'warrantyVoided', '') = 'PASS'
      and (
        stripe_promptpay_enabled = false
        or coalesce(shop62_acceptance_evidence->>'promptPay', '') = 'PASS'
      )
    )
  );

-- ------------------------------------------------------------
-- SHORT-LIVED TEST TOKEN
-- ------------------------------------------------------------

create or replace function public.set_shop62_test_token(test_token text, ttl_minutes integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  expires_at_value timestamptz;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  if char_length(coalesce(test_token, '')) < 32 then raise exception 'SHOP62_TEST_TOKEN_TOO_SHORT'; end if;
  if ttl_minutes < 5 or ttl_minutes > 120 then raise exception 'SHOP62_TEST_TOKEN_TTL_INVALID'; end if;

  expires_at_value := now() + make_interval(mins => ttl_minutes);
  update public.commerce_store_settings
     set shop62_test_token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(test_token, 'UTF8')), 'hex'),
         shop62_test_token_expires_at = expires_at_value
   where id = 1;
  return expires_at_value;
end;
$$;

revoke all on function public.set_shop62_test_token(text, integer) from public, anon, authenticated;
grant execute on function public.set_shop62_test_token(text, integer) to service_role;

create or replace function private.shop62_assert_test_token(test_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.commerce_store_settings%rowtype;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  select * into s from public.commerce_store_settings where id = 1 for update;
  if s.id is null then raise exception 'STORE_SETTINGS_NOT_FOUND'; end if;
  if s.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if s.shop62_test_token_hash is null or s.shop62_test_token_expires_at is null or s.shop62_test_token_expires_at <= now() then
    raise exception 'SHOP62_TEST_TOKEN_EXPIRED';
  end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(test_token, ''), 'UTF8')), 'hex') <> s.shop62_test_token_hash then
    raise exception 'SHOP62_TEST_TOKEN_INVALID';
  end if;
end;
$$;

revoke all on function private.shop62_assert_test_token(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- ISOLATED TEST ORDER CREATION
-- ------------------------------------------------------------
-- The existing create_commerce_order() remains the reservation/order owner. This wrapper
-- only creates an uncommitted, transaction-local settings bypass so AT-TST-* fixtures can
-- exercise the exact production order engine while public checkout remains disabled to
-- every concurrent transaction.

create or replace function public.create_commerce_test_order(checkout jsonb, test_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.commerce_store_settings%rowtype;
  result jsonb;
  sku text;
begin
  perform private.shop62_assert_test_token(test_token);
  select * into original from public.commerce_store_settings where id = 1 for update;

  if original.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if coalesce(jsonb_array_length(coalesce(checkout->'skus', '[]'::jsonb)), 0) < 1 then raise exception 'INVALID_CART_SIZE'; end if;

  for sku in select upper(btrim(value)) from jsonb_array_elements_text(coalesce(checkout->'skus', '[]'::jsonb))
  loop
    if sku !~ '^AT-TST-' then raise exception 'SHOP62_TEST_SKU_REQUIRED:%', sku; end if;
  end loop;

  perform pg_catalog.set_config('app.shop62_test_mode', 'on', true);

  update public.commerce_store_settings
     set purchase_enabled = true,
         stripe_enabled = true,
         shipping_enabled = true,
         return_policy_enabled = true,
         checkout_turnstile_enabled = true,
         turnstile_site_key = coalesce(nullif(turnstile_site_key, ''), 'SHOP62-TEST-ONLY'),
         reservation_minutes = greatest(reservation_minutes, 45),
         shipping_rate = coalesce(shipping_rate, 0),
         pickup_enabled = true,
         shop62_acceptance_version = 'SHOP-6.2',
         shop62_accepted_at = now(),
         shop62_acceptance_evidence = jsonb_build_object(
           'provider','STRIPE','mode','test','card','PASS','signedWebhook','PASS','duplicateEvent','PASS',
           'amountMismatch','PASS','currencyMismatch','PASS','reservationExpiry','PASS','shippingLifecycle','PASS',
           'pickupLifecycle','PASS','documentSnapshot','PASS','warrantySnapshot','PASS','refundReturned','PASS',
           'warrantyVoided','PASS','promptPay','PASS','temporaryBypass',true
         )
   where id = 1;

  result := public.create_commerce_order(checkout);

  update public.commerce_store_settings
     set purchase_enabled = original.purchase_enabled,
         stripe_enabled = original.stripe_enabled,
         shipping_enabled = original.shipping_enabled,
         return_policy_enabled = original.return_policy_enabled,
         checkout_turnstile_enabled = original.checkout_turnstile_enabled,
         turnstile_site_key = original.turnstile_site_key,
         reservation_minutes = original.reservation_minutes,
         shipping_rate = original.shipping_rate,
         pickup_enabled = original.pickup_enabled,
         shop62_acceptance_version = original.shop62_acceptance_version,
         shop62_accepted_at = original.shop62_accepted_at,
         shop62_acceptance_evidence = original.shop62_acceptance_evidence,
         shop62_last_invalidated_at = original.shop62_last_invalidated_at,
         shop62_last_invalidated_reason = original.shop62_last_invalidated_reason
   where id = 1;

  return result;
end;
$$;

revoke all on function public.create_commerce_test_order(jsonb, text) from public, anon, authenticated;
grant execute on function public.create_commerce_test_order(jsonb, text) to service_role;

-- ------------------------------------------------------------
-- ACCEPTANCE RECORDING
-- ------------------------------------------------------------

create or replace function public.record_shop62_provider_acceptance(evidence jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.commerce_store_settings%rowtype;
  promptpay_result text;
begin
  if not private.shop62_actor_is_service_or_postgres() then raise exception 'SHOP62_SERVICE_ROLE_REQUIRED'; end if;
  select * into s from public.commerce_store_settings where id = 1 for update;
  if s.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;

  if coalesce(evidence->>'provider','') <> 'STRIPE' or coalesce(evidence->>'mode','') <> 'test' then raise exception 'SHOP62_PROVIDER_EVIDENCE_INVALID'; end if;
  if coalesce(evidence->>'card','') <> 'PASS' then raise exception 'SHOP62_CARD_REQUIRED'; end if;
  if coalesce(evidence->>'signedWebhook','') <> 'PASS' then raise exception 'SHOP62_SIGNED_WEBHOOK_REQUIRED'; end if;
  if coalesce(evidence->>'duplicateEvent','') <> 'PASS' then raise exception 'SHOP62_DUPLICATE_EVENT_REQUIRED'; end if;
  if coalesce(evidence->>'amountMismatch','') <> 'PASS' then raise exception 'SHOP62_AMOUNT_MISMATCH_REQUIRED'; end if;
  if coalesce(evidence->>'currencyMismatch','') <> 'PASS' then raise exception 'SHOP62_CURRENCY_MISMATCH_REQUIRED'; end if;
  if coalesce(evidence->>'reservationExpiry','') <> 'PASS' then raise exception 'SHOP62_EXPIRY_REQUIRED'; end if;
  if coalesce(evidence->>'shippingLifecycle','') <> 'PASS' then raise exception 'SHOP62_SHIPPING_REQUIRED'; end if;
  if coalesce(evidence->>'pickupLifecycle','') <> 'PASS' then raise exception 'SHOP62_PICKUP_REQUIRED'; end if;
  if coalesce(evidence->>'documentSnapshot','') <> 'PASS' then raise exception 'SHOP62_DOCUMENT_REQUIRED'; end if;
  if coalesce(evidence->>'warrantySnapshot','') <> 'PASS' then raise exception 'SHOP62_WARRANTY_REQUIRED'; end if;
  if coalesce(evidence->>'refundReturned','') <> 'PASS' then raise exception 'SHOP62_REFUND_REQUIRED'; end if;
  if coalesce(evidence->>'warrantyVoided','') <> 'PASS' then raise exception 'SHOP62_WARRANTY_VOID_REQUIRED'; end if;

  promptpay_result := coalesce(evidence->>'promptPay','');
  if s.stripe_promptpay_enabled is true and promptpay_result <> 'PASS' then raise exception 'SHOP62_PROMPTPAY_REQUIRED'; end if;
  if s.stripe_promptpay_enabled is false and promptpay_result not in ('PASS','SKIPPED_DISABLED') then raise exception 'SHOP62_PROMPTPAY_EVIDENCE_INVALID'; end if;

  update public.commerce_store_settings
     set purchase_enabled = false,
         shop62_acceptance_version = 'SHOP-6.2',
         shop62_accepted_at = now(),
         shop62_acceptance_evidence = evidence || jsonb_build_object('recordedAt', now()),
         shop62_test_token_hash = null,
         shop62_test_token_expires_at = null,
         shop62_last_invalidated_reason = null
   where id = 1
   returning * into s;

  return jsonb_build_object(
    'version', s.shop62_acceptance_version,
    'acceptedAt', s.shop62_accepted_at,
    'purchaseEnabled', s.purchase_enabled,
    'evidence', s.shop62_acceptance_evidence
  );
end;
$$;

revoke all on function public.record_shop62_provider_acceptance(jsonb) from public, anon, authenticated;
grant execute on function public.record_shop62_provider_acceptance(jsonb) to service_role;

-- ------------------------------------------------------------
-- REFUND/WARRANTY SAFETY
-- ------------------------------------------------------------
-- Void any issued warranty and cancel unresolved claims after a full refund, regardless
-- of whether the refund arrived before or after fulfillment metadata was written.

create or replace function private.shop62_void_warranty_after_refund()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'REFUNDED' and old.payment_status is distinct from 'REFUNDED' then
    update public.commerce_warranties
       set status = 'VOID'
     where order_id = new.id
       and status <> 'VOID';

    update public.commerce_warranty_claims c
       set status = 'CANCELLED',
           resolution = coalesce(c.resolution, 'Order fully refunded'),
           resolved_at = coalesce(c.resolved_at, now()),
           updated_at = now()
     where c.warranty_id in (select w.id from public.commerce_warranties w where w.order_id = new.id)
       and c.status in ('OPEN','IN_REVIEW','APPROVED');

    update public.commerce_documents
       set voided_at = coalesce(voided_at, now())
     where order_id = new.id
       and voided_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.shop62_void_warranty_after_refund() from public, anon, authenticated;

drop trigger if exists commerce_orders_shop62_refund_cleanup on public.commerce_orders;
create trigger commerce_orders_shop62_refund_cleanup
after update of payment_status on public.commerce_orders
for each row execute procedure private.shop62_void_warranty_after_refund();

-- Refund race hardening: if Stripe's signed webhook confirms the refund before the API
-- call can mark REFUND_PENDING, treat the later mark-pending call as an idempotent success.
create or replace function public.mark_commerce_gateway_refund_pending(target_order_id uuid, provider_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.commerce_orders%rowtype;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;

  if o.payment_status='REFUNDED' then
    update public.commerce_orders
       set provider_refund_id = coalesce(provider_refund_id, public.commerce_orders.provider_refund_id),
           refund_status = coalesce(refund_status, 'SUCCEEDED')
     where id=o.id
     returning * into o;
    return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',true);
  end if;

  if o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders
     set payment_status='REFUND_PENDING',provider_refund_id=provider_refund_id,refund_status='PENDING'
   where id=o.id returning * into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',false);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

-- ------------------------------------------------------------
-- TEST FIXTURE CLEANUP
-- ------------------------------------------------------------

create or replace function public.cleanup_shop62_test_fixtures(test_token text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order uuid;
  removed integer := 0;
begin
  perform private.shop62_assert_test_token(test_token);

  for target_order in
    select distinct oi.order_id
      from public.commerce_order_items oi
     where oi.sku like 'AT-TST-%'
  loop
    delete from public.commerce_warranty_claims where warranty_id in (select id from public.commerce_warranties where order_id=target_order);
    delete from public.commerce_warranties where order_id=target_order;
    delete from public.commerce_documents where order_id=target_order;
    delete from public.commerce_fulfillment_events where order_id=target_order;
    delete from public.commerce_shipments where order_id=target_order;
    delete from public.commerce_payment_events where order_id=target_order;
    delete from public.commerce_payment_transactions where order_id=target_order;
    delete from public.commerce_reservations where order_id=target_order;
    delete from public.commerce_order_items where order_id=target_order;
    delete from public.commerce_orders where id=target_order;
    removed := removed + 1;
  end loop;

  delete from public.products where sku like 'AT-TST-%';
  return removed;
end;
$$;

revoke all on function public.cleanup_shop62_test_fixtures(text) from public, anon, authenticated;
grant execute on function public.cleanup_shop62_test_fixtures(text) to service_role;

-- ------------------------------------------------------------
-- SERVER-ONLY SECURITY + READINESS VIEW
-- ------------------------------------------------------------

create or replace view public.commerce_shop62_acceptance_v
with (security_invoker = true)
as
select
  s.purchase_enabled,
  s.stripe_enabled,
  s.stripe_promptpay_enabled,
  s.shop62_acceptance_version,
  s.shop62_accepted_at,
  s.shop62_acceptance_evidence,
  s.shop62_last_invalidated_at,
  s.shop62_last_invalidated_reason,
  case
    when s.shop62_acceptance_version='SHOP-6.2'
      and s.shop62_accepted_at is not null
      and coalesce(s.shop62_acceptance_evidence->>'card','')='PASS'
      and coalesce(s.shop62_acceptance_evidence->>'signedWebhook','')='PASS'
      and coalesce(s.shop62_acceptance_evidence->>'refundReturned','')='PASS'
      and (s.stripe_promptpay_enabled=false or coalesce(s.shop62_acceptance_evidence->>'promptPay','')='PASS')
    then true else false
  end as provider_acceptance_ready
from public.commerce_store_settings s
where s.id=1;

revoke all on public.commerce_shop62_acceptance_v from anon, authenticated;
grant select on public.commerce_shop62_acceptance_v to service_role;

-- Keep the release closed by default. The separate activation step remains explicit.
update public.commerce_store_settings set purchase_enabled=false where id=1;


-- ------------------------------------------------------------
-- SHOP-6.2 GATEWAY AMBIGUITY FIX (canonical clean-install definition)
-- ------------------------------------------------------------
-- SHOP-6.2 forward fix: make gateway event/refund functions explicit about
-- PL/pgSQL values versus table columns. Keep the public signatures unchanged.

create or replace function public.process_gateway_payment_event(
  provider_name text,
  provider_event_id text,
  normalized_event text,
  target_order_id uuid default null,
  provider_payment_id text default null,
  amount_minor bigint default null,
  currency_code text default null,
  event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_event_id uuid;
  o public.commerce_orders%rowtype;
  expected_minor bigint;
  v_provider_name text := upper(provider_name);
  v_provider_event_id text := provider_event_id;
  v_action text := upper(normalized_event);
  v_target_order_id uuid := target_order_id;
  v_provider_payment_id text := provider_payment_id;
  v_amount_minor bigint := amount_minor;
  v_currency_code text := upper(currency_code);
  v_event_payload jsonb := coalesce(event_payload,'{}'::jsonb);
  item record;
begin
  insert into public.commerce_payment_events(provider,provider_event_id,event_type,order_id,provider_payment_id,amount_minor,currency,payload)
  values(v_provider_name,v_provider_event_id,v_action,v_target_order_id,v_provider_payment_id,v_amount_minor,v_currency_code,v_event_payload)
  on conflict on constraint commerce_payment_events_provider_provider_event_id_key do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then return jsonb_build_object('duplicate',true,'providerEventId',v_provider_event_id); end if;

  if v_target_order_id is not null then select co.* into o from public.commerce_orders as co where co.id=v_target_order_id for update;
  elsif v_provider_payment_id is not null then select co.* into o from public.commerce_orders as co where co.provider_payment_intent_id=v_provider_payment_id for update;
  end if;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or v_provider_name<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;

  if v_provider_payment_id is not null and o.provider_payment_intent_id is null then
    update public.commerce_orders as co set provider_payment_intent_id=v_provider_payment_id where co.id=o.id returning co.* into o;
  end if;

  if v_action='PAYMENT_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is null or v_amount_minor<>expected_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    if coalesce(v_currency_code,'')<>upper(o.currency) then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
    perform private.mark_commerce_order_paid(o.id,null,'STRIPE',v_provider_payment_id);
    update public.commerce_orders as co set provider_payment_status='PAID',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt
       set provider_status='PAID',payment_intent_id=coalesce(v_provider_payment_id,cpt.payment_intent_id),paid_at=coalesce(cpt.paid_at,now()),updated_at=now()
     where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='PAYMENT_FAILED' then
    update public.commerce_orders as co set provider_payment_status='FAILED' where co.id=o.id and co.payment_status='UNPAID';
    update public.commerce_payment_transactions as cpt set provider_status='FAILED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='CHECKOUT_EXPIRED' then
    if o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'EXPIRED'); end if;
    update public.commerce_orders as co set provider_payment_status='EXPIRED',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='EXPIRED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='REFUND_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is not null and v_amount_minor<>expected_minor then raise exception 'PARTIAL_REFUND_NOT_SUPPORTED'; end if;
    if o.payment_status not in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select pitem.product_id from public.commerce_order_items as pitem where pitem.order_id=o.id order by pitem.product_id loop
      perform 1 from public.products as p where p.id=item.product_id for update;
      update public.products as p set status='returned',updated_by=null where p.id=item.product_id and p.status='sold';
    end loop;
    update public.commerce_orders as co set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='SUCCEEDED',provider_payment_status='REFUNDED' where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='REFUNDED',refunded_at=now(),updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_CONFIRMED',jsonb_build_object('provider','STRIPE'));
  elsif v_action='REFUND_FAILED' then
    update public.commerce_orders as co set payment_status=case when co.payment_status='REFUND_PENDING' then 'PAID' else co.payment_status end,refund_status='FAILED' where co.id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_FAILED',jsonb_build_object('provider','STRIPE'));
  else
    raise exception 'UNSUPPORTED_GATEWAY_EVENT';
  end if;

  update public.commerce_payment_events as cpe set processed=true,processed_at=now(),order_id=o.id where cpe.id=inserted_event_id;
  select co.* into o from public.commerce_orders as co where co.id=o.id;
  return jsonb_build_object('duplicate',false,'orderId',o.id,'orderNumber',o.order_number,'paymentStatus',o.payment_status,'orderStatus',o.order_status,'fulfillmentStatus',o.fulfillment_status);
end;
$$;

revoke all on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) to service_role;

create or replace function public.mark_commerce_gateway_refund_pending(target_order_id uuid, provider_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_provider_refund_id text := provider_refund_id;
begin
  select co.* into o from public.commerce_orders as co where co.id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;

  if o.payment_status='REFUNDED' then
    update public.commerce_orders as co
       set provider_refund_id = coalesce(v_provider_refund_id, co.provider_refund_id),
           refund_status = coalesce(co.refund_status, 'SUCCEEDED')
     where co.id=o.id
     returning co.* into o;
    return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',true);
  end if;

  if o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders as co
     set payment_status='REFUND_PENDING',provider_refund_id=v_provider_refund_id,refund_status='PENDING'
   where co.id=o.id returning co.* into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',v_provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',false);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

-- Preserve the production release gate explicitly.
update public.commerce_store_settings set purchase_enabled=false where id=1;



-- ------------------------------------------------------------
-- SHOP-6.2 20260912113000 forward fix: test settings completeness
-- ------------------------------------------------------------
-- SHOP-6.2 forward fix: make the private E2E checkout helper satisfy the
-- production shipping/return completeness constraints while it temporarily
-- enables checkout inside test mode. The original settings are restored before
-- the helper returns, and failed statements roll back atomically.

create or replace function public.create_commerce_test_order(checkout jsonb, test_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.commerce_store_settings%rowtype;
  result jsonb;
  sku text;
begin
  perform private.shop62_assert_test_token(test_token);
  select * into original from public.commerce_store_settings where id = 1 for update;

  if original.purchase_enabled is true then raise exception 'SHOP62_REQUIRES_PUBLIC_CHECKOUT_DISABLED'; end if;
  if coalesce(jsonb_array_length(coalesce(checkout->'skus', '[]'::jsonb)), 0) < 1 then raise exception 'INVALID_CART_SIZE'; end if;

  for sku in select upper(btrim(value)) from jsonb_array_elements_text(coalesce(checkout->'skus', '[]'::jsonb))
  loop
    if sku !~ '^AT-TST-' then raise exception 'SHOP62_TEST_SKU_REQUIRED:%', sku; end if;
  end loop;

  perform pg_catalog.set_config('app.shop62_test_mode', 'on', true);

  update public.commerce_store_settings
     set purchase_enabled = true,
         stripe_enabled = true,
         shipping_enabled = true,
         shipping_country = 'TH',
         shipping_rate = 0,
         handling_min_days = 0,
         handling_max_days = 1,
         transit_min_days = 1,
         transit_max_days = 3,
         return_policy_enabled = true,
         return_policy_category = 'FINITE',
         return_days = 7,
         return_method = 'MAIL_AND_IN_STORE',
         return_fees = 'CUSTOMER_RESPONSIBILITY',
         checkout_turnstile_enabled = true,
         turnstile_site_key = coalesce(nullif(turnstile_site_key, ''), 'SHOP62-TEST-ONLY'),
         reservation_minutes = greatest(reservation_minutes, 45),
         pickup_enabled = true,
         shop62_acceptance_version = 'SHOP-6.2',
         shop62_accepted_at = now(),
         shop62_acceptance_evidence = jsonb_build_object(
           'provider','STRIPE','mode','test','card','PASS','signedWebhook','PASS','duplicateEvent','PASS',
           'amountMismatch','PASS','currencyMismatch','PASS','reservationExpiry','PASS','shippingLifecycle','PASS',
           'pickupLifecycle','PASS','documentSnapshot','PASS','warrantySnapshot','PASS','refundReturned','PASS',
           'warrantyVoided','PASS','promptPay','PASS','temporaryBypass',true
         )
   where id = 1;

  result := public.create_commerce_order(checkout);

  update public.commerce_store_settings
     set purchase_enabled = original.purchase_enabled,
         stripe_enabled = original.stripe_enabled,
         shipping_enabled = original.shipping_enabled,
         shipping_country = original.shipping_country,
         shipping_rate = original.shipping_rate,
         handling_min_days = original.handling_min_days,
         handling_max_days = original.handling_max_days,
         transit_min_days = original.transit_min_days,
         transit_max_days = original.transit_max_days,
         return_policy_enabled = original.return_policy_enabled,
         return_policy_category = original.return_policy_category,
         return_days = original.return_days,
         return_method = original.return_method,
         return_fees = original.return_fees,
         checkout_turnstile_enabled = original.checkout_turnstile_enabled,
         turnstile_site_key = original.turnstile_site_key,
         reservation_minutes = original.reservation_minutes,
         pickup_enabled = original.pickup_enabled,
         shop62_acceptance_version = original.shop62_acceptance_version,
         shop62_accepted_at = original.shop62_accepted_at,
         shop62_acceptance_evidence = original.shop62_acceptance_evidence,
         shop62_last_invalidated_at = original.shop62_last_invalidated_at,
         shop62_last_invalidated_reason = original.shop62_last_invalidated_reason
   where id = 1;

  return result;
end;
$$;

revoke all on function public.create_commerce_test_order(jsonb, text) from public, anon, authenticated;
grant execute on function public.create_commerce_test_order(jsonb, text) to service_role;

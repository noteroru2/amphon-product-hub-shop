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

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

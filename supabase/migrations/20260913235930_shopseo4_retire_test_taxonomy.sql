begin;

-- SHOP-SEO-4: retire the orphaned SHOP62 acceptance-test taxonomy.
-- It has no aliases, series, models, or listing references and must never become indexable.
update public.commerce_brand_pages bp
set
  index_policy = 'RETIRED',
  is_active = false,
  updated_at = now()
where bp.brand_id in (
  select b.id
  from public.commerce_brands b
  where lower(b.name) = 'shop62' or lower(b.slug) = 'shop62'
)
and not exists (
  select 1 from public.commerce_listings cl where cl.brand_id = bp.brand_id
);

update public.commerce_brands b
set
  index_policy = 'RETIRED',
  is_active = false,
  updated_at = now()
where (lower(b.name) = 'shop62' or lower(b.slug) = 'shop62')
and not exists (
  select 1 from public.commerce_listings cl where cl.brand_id = b.id
)
and not exists (
  select 1 from public.commerce_series s where s.brand_id = b.id
)
and not exists (
  select 1 from public.commerce_models m where m.brand_id = b.id
)
and not exists (
  select 1 from public.commerce_brand_aliases ba where ba.brand_id = b.id
);

commit;

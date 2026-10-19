-- P0: Previously published Facebook posts were baselined without reading Graph.
-- Treat price_synced_at (written only after Graph read-back) as the verification
-- watermark. Historical baselines are informational and must not suppress sync.
-- The worker will edit existing posts in place; it never creates a new post.

create or replace function public.facebook_price_sync_candidates(max_posts integer default 5)
returns table (
  id uuid,
  product_id uuid,
  connection_key text,
  post_id text,
  sku text,
  price numeric,
  one_pricing_updated_at timestamptz,
  price_sync_attempts integer
)
language sql security invoker set search_path = '' as $$
  select
    l.id,
    l.product_id,
    l.connection_key,
    l.post_id,
    p.sku,
    (case when (
       coalesce(p.one_dealer_eligibility,'') = 'CLEARANCE'
       or coalesce(p.one_stock_age_days,0) > 60
       or coalesce(p.one_stock_age_days,0) between 31 and 45
    ) and coalesce(p.one_quick_sale_price,0) > 0
      then p.one_quick_sale_price else p.price end)::numeric,
    p.one_pricing_updated_at,
    coalesce(l.price_sync_attempts,0)
  from public.facebook_post_ledger l
  join public.products p on p.id=l.product_id
  where l.status = 'LIVE'
    and p.one_managed = true
    and p.status in ('ready_to_list','published','reserved')
    and p.one_availability in ('IN_STOCK','RESERVED')
    and coalesce(p.price,0) > 0
    and p.one_pricing_updated_at is not null
    -- NULL means the Facebook post was NEVER checked, even if a baseline exists.
    and (l.price_synced_at is null or l.price_synced_at < p.one_pricing_updated_at)
    and (l.price_sync_retry_at is null or l.price_sync_retry_at <= now())
  order by p.one_pricing_updated_at desc, l.price_synced_at nulls first, l.id
  limit greatest(1, least(coalesce(max_posts,5),20))
$$;

revoke all on function public.facebook_price_sync_candidates(integer) from public, anon, authenticated;
grant execute on function public.facebook_price_sync_candidates(integer) to service_role;
comment on function public.facebook_price_sync_candidates(integer) is
  'Service-role only: verify all unverified current price revisions against existing LIVE Facebook posts; legacy baseline is not proof of sync.';

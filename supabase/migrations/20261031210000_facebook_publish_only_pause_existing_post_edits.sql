-- 2026-10-31: Publish-only mode while Meta Error 368 affects edits of existing posts.
-- Preserve pending edit work in facebook_post_ledger and preserve page write cooldowns.
ALTER TABLE public.facebook_rotation_settings
  ADD COLUMN IF NOT EXISTS price_sync_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_sync_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.facebook_rotation_settings.price_sync_paused IS
  'When true, no candidate is returned for scheduled Facebook edits to existing post prices.';
COMMENT ON COLUMN public.facebook_rotation_settings.catalog_sync_paused IS
  'When true, no candidate is returned for scheduled Facebook edits to existing post text/images.';

-- The sold-edit circuit breaker was already enabled after Meta 368.
-- Enforce only-new-post publication across all three automatic edit types.
UPDATE public.facebook_rotation_settings
SET sold_sync_paused=true,
    price_sync_paused=true,
    catalog_sync_paused=true,
    updated_at=now()
WHERE id=true;

CREATE OR REPLACE FUNCTION public.facebook_catalog_sync_candidates(max_posts integer DEFAULT 3)
 RETURNS TABLE(id uuid, product_id uuid, connection_key text, post_id text, sku text,
               content_revision timestamptz, image_revision timestamptz,
               image_synced_revision timestamptz, catalog_attempts integer)
 LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$
  SELECT l.id,l.product_id,l.connection_key,l.post_id,p.sku,
    p.public_content_revision_at,p.public_images_revision_at,l.image_synced_revision_at,
    coalesce(l.catalog_sync_attempts,0)
  FROM public.facebook_post_ledger l
  JOIN public.products p ON p.id=l.product_id
  JOIN public.sales_channel_connections c
    ON c.channel_key='facebook_page' AND c.connection_key=l.connection_key
  WHERE EXISTS (
    SELECT 1 FROM public.facebook_rotation_settings s
    WHERE s.id=true AND s.catalog_sync_paused=false
  )
    AND l.status='LIVE'
    AND c.activation_status='ACTIVE' AND c.environment='PRODUCTION'
    AND p.status IN ('ready_to_list','published','reserved')
    AND (p.one_managed IS DISTINCT FROM TRUE OR p.one_availability IN ('IN_STOCK','RESERVED'))
    AND coalesce(p.price,0)>0
    AND (l.catalog_synced_revision_at IS NULL OR l.catalog_synced_revision_at < p.public_content_revision_at
         OR l.image_synced_revision_at IS NULL OR l.image_synced_revision_at < p.public_images_revision_at)
    AND (l.catalog_sync_retry_at IS NULL OR l.catalog_sync_retry_at <= now())
  ORDER BY p.public_content_revision_at DESC,l.catalog_synced_revision_at NULLS FIRST,l.id
  LIMIT greatest(1,least(coalesce(max_posts,3),10))
$function$;

CREATE OR REPLACE FUNCTION public.facebook_price_sync_candidates(max_posts integer DEFAULT 5)
 RETURNS TABLE(id uuid, product_id uuid, connection_key text, post_id text, sku text,
               price numeric, one_pricing_updated_at timestamptz, price_sync_attempts integer)
 LANGUAGE sql SECURITY INVOKER SET search_path TO ''
AS $function$
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
  where EXISTS (
    SELECT 1 FROM public.facebook_rotation_settings s
    WHERE s.id=true AND s.price_sync_paused=false
  )
    and l.status = 'LIVE'
    and p.one_managed = true
    and p.status in ('ready_to_list','published','reserved')
    and p.one_availability in ('IN_STOCK','RESERVED')
    and coalesce(p.price,0) > 0
    and p.one_pricing_updated_at is not null
    and (l.price_synced_at is null or l.price_synced_at < p.one_pricing_updated_at)
    and (l.price_sync_retry_at is null or l.price_sync_retry_at <= now())
  order by p.one_pricing_updated_at desc, l.price_synced_at nulls first, l.id
  limit greatest(1,least(coalesce(max_posts,5),20))
$function$;

REVOKE ALL ON FUNCTION public.facebook_catalog_sync_candidates(integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.facebook_price_sync_candidates(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_catalog_sync_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.facebook_price_sync_candidates(integer) TO service_role;

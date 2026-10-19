-- Inventory-public field and image revisions for downstream channel reconciliation.
-- Never propagate internal cost, dealer floor, customer details, or employee notes.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS public_content_revision_at timestamptz,
  ADD COLUMN IF NOT EXISTS public_images_revision_at timestamptz;

UPDATE public.products
SET public_content_revision_at = coalesce(updated_at, now()),
    public_images_revision_at = now()
WHERE public_content_revision_at IS NULL OR public_images_revision_at IS NULL;

ALTER TABLE public.products
  ALTER COLUMN public_content_revision_at SET DEFAULT now(),
  ALTER COLUMN public_images_revision_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.amphon_stamp_public_product_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.title,NEW.category,NEW.brand,NEW.model,NEW.subtype,
         NEW.condition_percent,NEW.warranty_until,NEW.defects,NEW.specs,
         NEW.battery_health_grade,NEW.status,NEW.price,
         NEW.one_quick_sale_price,NEW.one_dealer_eligibility,NEW.one_stock_age_days)
     IS DISTINCT FROM
     ROW(OLD.title,OLD.category,OLD.brand,OLD.model,OLD.subtype,
         OLD.condition_percent,OLD.warranty_until,OLD.defects,OLD.specs,
         OLD.battery_health_grade,OLD.status,OLD.price,
         OLD.one_quick_sale_price,OLD.one_dealer_eligibility,OLD.one_stock_age_days)
  THEN
    NEW.public_content_revision_at := greatest(
      clock_timestamp(),coalesce(OLD.public_content_revision_at,'epoch'::timestamptz)+interval '1 microsecond');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS amphon_stamp_public_product_change ON public.products;
CREATE TRIGGER amphon_stamp_public_product_change
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.amphon_stamp_public_product_change();

CREATE OR REPLACE FUNCTION public.amphon_stamp_public_image_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE product_key uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(OLD.product_id,OLD.object_key,OLD.public_url,OLD.sort_order,
                              OLD.is_cover,OLD.image_role)
                           IS NOT DISTINCT FROM ROW(NEW.product_id,NEW.object_key,NEW.public_url,
                              NEW.sort_order,NEW.is_cover,NEW.image_role)
  THEN RETURN NEW; END IF;
  product_key := CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  UPDATE public.products
  SET public_images_revision_at = greatest(
    clock_timestamp(),coalesce(public_images_revision_at,'epoch'::timestamptz)+interval '1 microsecond')
  WHERE id = product_key;
  IF TG_OP='UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    UPDATE public.products
    SET public_images_revision_at = greatest(
      clock_timestamp(),coalesce(public_images_revision_at,'epoch'::timestamptz)+interval '1 microsecond')
    WHERE id = OLD.product_id;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS amphon_stamp_public_image_change ON public.product_images;
CREATE TRIGGER amphon_stamp_public_image_change
AFTER INSERT OR UPDATE OR DELETE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.amphon_stamp_public_image_change();

ALTER TABLE public.facebook_post_ledger
  ADD COLUMN IF NOT EXISTS catalog_synced_revision_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_sync_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS catalog_sync_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_sync_error text,
  ADD COLUMN IF NOT EXISTS image_synced_revision_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_sync_status text,
  ADD COLUMN IF NOT EXISTS image_sync_error text;

-- Existing image posts cannot be assumed fully verified. Snapshot the current
-- image set; future image edits are tracked. Text is verified on first sweep.
UPDATE public.facebook_post_ledger l
SET image_synced_revision_at=p.public_images_revision_at,
    image_sync_status='LEGACY_BASELINE_UNVERIFIED'
FROM public.products p
WHERE l.product_id=p.id AND l.status='LIVE' AND l.image_synced_revision_at IS NULL;

CREATE OR REPLACE FUNCTION public.amphon_facebook_new_post_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.image_synced_revision_at IS NULL THEN
    SELECT p.public_images_revision_at INTO NEW.image_synced_revision_at
    FROM public.products p WHERE p.id=NEW.product_id;
    NEW.image_sync_status := 'PUBLISHED_SNAPSHOT';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS amphon_facebook_new_post_snapshot ON public.facebook_post_ledger;
CREATE TRIGGER amphon_facebook_new_post_snapshot
BEFORE INSERT ON public.facebook_post_ledger
FOR EACH ROW EXECUTE FUNCTION public.amphon_facebook_new_post_snapshot();

CREATE INDEX IF NOT EXISTS facebook_catalog_retry_idx
ON public.facebook_post_ledger(status,catalog_sync_retry_at,catalog_synced_revision_at)
WHERE status='LIVE';

CREATE OR REPLACE FUNCTION public.facebook_catalog_sync_candidates(max_posts integer DEFAULT 3)
RETURNS TABLE(
  id uuid, product_id uuid, connection_key text, post_id text,
  sku text, content_revision timestamptz, image_revision timestamptz,
  image_synced_revision timestamptz, catalog_attempts integer
)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT l.id,l.product_id,l.connection_key,l.post_id,p.sku,
    p.public_content_revision_at,p.public_images_revision_at,l.image_synced_revision_at,
    coalesce(l.catalog_sync_attempts,0)
  FROM public.facebook_post_ledger l
  JOIN public.products p ON p.id=l.product_id
  JOIN public.sales_channel_connections c
    ON c.channel_key='facebook_page' AND c.connection_key=l.connection_key
  WHERE l.status='LIVE'
    AND c.activation_status='ACTIVE' AND c.environment='PRODUCTION'
    AND p.status IN ('ready_to_list','published','reserved')
    AND (p.one_managed IS DISTINCT FROM TRUE OR p.one_availability IN ('IN_STOCK','RESERVED'))
    AND coalesce(p.price,0)>0
    AND (l.catalog_synced_revision_at IS NULL OR l.catalog_synced_revision_at < p.public_content_revision_at
         OR l.image_synced_revision_at IS NULL OR l.image_synced_revision_at < p.public_images_revision_at)
    AND (l.catalog_sync_retry_at IS NULL OR l.catalog_sync_retry_at <= now())
  ORDER BY p.public_content_revision_at DESC,l.catalog_synced_revision_at NULLS FIRST,l.id
  LIMIT greatest(1,least(coalesce(max_posts,3),10))
$$;
REVOKE ALL ON FUNCTION public.facebook_catalog_sync_candidates(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_catalog_sync_candidates(integer) TO service_role;
COMMENT ON FUNCTION public.facebook_catalog_sync_candidates(integer) IS
  'Server only: public catalogue changes or image revisions requiring existing Facebook post read-back; never reposts.';
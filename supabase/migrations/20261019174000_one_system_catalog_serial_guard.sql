-- Follow-up idempotent guard: multi-unit inventory is not the owner of
-- individual device serial numbers stored in Product Hub.
-- Safe integration of System-owned catalogue metadata into the Hub.
-- No overwrite of R2 photos or private prices and no guessing unmapped SKUs.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS one_catalog_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS system_images_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS system_images_review_required boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.one_catalog_consume_event(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  e public.integration_event_inbox%rowtype;
  payload jsonb;
  link public.external_entity_links%rowtype;
  target_id uuid;
  identity_id text;
  sku_value text;
  catalog_date timestamptz;
  source_name text;
  category_value text;
  error_code text;
BEGIN
  SELECT * INTO e FROM public.integration_event_inbox WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','NOT_FOUND'); END IF;
  IF e.status='PROCESSED' THEN RETURN jsonb_build_object('outcome','DUPLICATE'); END IF;
  IF e.status='DEAD' THEN RETURN jsonb_build_object('outcome','DEAD','error',e.last_error); END IF;
  payload:=e.payload->'payload';
  identity_id:=nullif(btrim(coalesce(payload->>'productIdentityId','')),'');
  sku_value:=upper(nullif(btrim(coalesce(payload->>'sku','')),''));
  source_name:=nullif(btrim(coalesce(payload->>'name','')),'');
  IF e.source<>'amphon-system' OR e.event_type<>'product.catalog_changed'
    OR e.entity_type<>'product_intake_unit'
    OR identity_id IS NULL OR sku_value IS NULL OR source_name IS NULL
    OR e.entity_id IS DISTINCT FROM identity_id
    OR upper(coalesce(e.entity_sku,''))<>sku_value
    OR coalesce(e.payload#>>'{entity,id}','')<>identity_id
    OR upper(coalesce(e.payload#>>'{entity,sku}',''))<>sku_value
    OR coalesce(payload->>'catalogUpdatedAt','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T'
  THEN
    error_code:='CATALOG_EVENT_INVALID';
    UPDATE public.integration_event_inbox
      SET status='DEAD',last_error=error_code,updated_at=now() WHERE id=e.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',error_code);
  END IF;
  catalog_date:=(payload->>'catalogUpdatedAt')::timestamptz;
  IF catalog_date>now()+interval '5 minutes' THEN
    error_code:='CATALOG_EVENT_FUTURE_REVISION';
    UPDATE public.integration_event_inbox
      SET status='DEAD',last_error=error_code,updated_at=now() WHERE id=e.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',error_code);
  END IF;

  SELECT * INTO link FROM public.external_entity_links
  WHERE source_system='amphon-system'
    AND source_entity_type='product_intake_unit' AND source_entity_id=identity_id
    AND target_system='product-hub' AND target_entity_type='product'
    AND sync_status='LINKED'
  LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.integration_event_inbox
      SET status='FAILED',last_error='CATALOG_MAPPING_NOT_FOUND',updated_at=now() WHERE id=e.id;
    RETURN jsonb_build_object('outcome','RETRY','error','CATALOG_MAPPING_NOT_FOUND');
  END IF;
  BEGIN target_id:=link.target_entity_id::uuid;
  EXCEPTION WHEN others THEN target_id:=NULL; END;
  IF target_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.products
    WHERE id=target_id AND upper(sku)=sku_value AND one_managed=true
  ) THEN
    error_code:='CATALOG_MAPPING_CONFLICT';
    UPDATE public.integration_event_inbox
      SET status='DEAD',last_error=error_code,updated_at=now() WHERE id=e.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',error_code);
  END IF;

  IF EXISTS(SELECT 1 FROM public.products WHERE id=target_id
    AND (status IN ('sold','cancelled','returned')
         OR (one_catalog_updated_at IS NOT NULL AND one_catalog_updated_at>catalog_date))
  ) THEN
    UPDATE public.integration_event_inbox
      SET status='PROCESSED',processed_at=coalesce(processed_at,now()),
          last_error=NULL,updated_at=now() WHERE id=e.id;
    RETURN jsonb_build_object('outcome','STALE','sku',sku_value);
  END IF;

  category_value:=lower(btrim(coalesce(payload->>'category','')));
  UPDATE public.products
  SET title=left(source_name,500),
      category=CASE WHEN category_value IN
        ('notebook','pc','iphone','smartphone','tablet','camera','lens',
         'monitor','component','gaming','accessory','other')
        THEN category_value ELSE category END,
      serial_number=CASE WHEN coalesce((payload->>'serialAuthoritative')::boolean,false)
        THEN nullif(left(btrim(coalesce(payload->>'serialNumber','')),255),'') ELSE serial_number END,
      specs=coalesce(specs,'{}'::jsonb) || jsonb_build_object(
        'system_condition',nullif(left(btrim(coalesce(payload->>'condition','')),1500),''),
        'system_accessories',nullif(left(btrim(coalesce(payload->>'accessories','')),1500),'')
      ),
      one_catalog_updated_at=catalog_date,
      system_images_changed_at=CASE WHEN coalesce((payload->>'sourceImagesChanged')::boolean,false)
        THEN catalog_date ELSE system_images_changed_at END,
      system_images_review_required=CASE WHEN coalesce((payload->>'sourceImagesChanged')::boolean,false)
        THEN true ELSE system_images_review_required END,
      updated_at=now()
  WHERE id=target_id;

  UPDATE public.integration_event_inbox
    SET status='PROCESSED',processed_at=coalesce(processed_at,now()),
        last_error=NULL,updated_at=now() WHERE id=e.id;
  RETURN jsonb_build_object('outcome','APPLIED','sku',sku_value,
    'hubProductId',target_id::text,
    'sourceImagesRequireReview',coalesce((payload->>'sourceImagesChanged')::boolean,false));
END $$;

REVOKE ALL ON FUNCTION public.one_catalog_consume_event(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.one_catalog_consume_event(uuid) TO service_role;
COMMENT ON FUNCTION public.one_catalog_consume_event(uuid) IS
  'Server-only strict SKU and revision guarded System->Hub public catalogue projection; System image JSON flagged for safe R2 review.';

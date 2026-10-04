-- Allow System-authoritative refund/return flow to reopen a previously SOLD ONE-managed product.
-- Reuse product.release_requested with fromAvailability=SOLD and toAvailability=IN_STOCK.
-- This keeps the existing event contract and version discipline while supporting resale after refund.

CREATE OR REPLACE FUNCTION public.one3c_consume_stock_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inbox public.integration_event_inbox%rowtype;
  v_envelope jsonb;
  v_payload jsonb;
  v_identity_id text;
  v_hub_product_id uuid;
  v_sku text;
  v_from text;
  v_to text;
  v_expected_to text;
  v_reason text;
  v_version bigint;
  v_product public.products%rowtype;
  v_link public.external_entity_links%rowtype;
  v_next_status text;
  v_has_publication boolean := false;
  v_ack_event_id uuid;
  v_ack_idempotency text;
  v_ack_payload jsonb;
  v_error text;
BEGIN
  SELECT * INTO v_inbox
  FROM public.integration_event_inbox
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome','NOT_FOUND','error','BRIDGE_INBOX_EVENT_NOT_FOUND');
  END IF;

  IF v_inbox.status = 'PROCESSED' THEN
    RETURN jsonb_build_object('outcome','DUPLICATE','sku',v_inbox.entity_sku);
  END IF;

  IF v_inbox.status = 'DEAD' THEN
    RETURN jsonb_build_object('outcome','DEAD','error',coalesce(v_inbox.last_error,'BRIDGE_EVENT_DEAD'));
  END IF;

  UPDATE public.integration_event_inbox
  SET status = 'PROCESSING', attempts = attempts + 1, last_error = null, updated_at = now()
  WHERE id = v_inbox.id;

  v_envelope := v_inbox.payload;
  v_payload := v_envelope -> 'payload';
  v_identity_id := nullif(btrim(coalesce(v_payload ->> 'productIdentityId','')), '');
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));
  v_from := upper(nullif(btrim(coalesce(v_payload ->> 'fromAvailability','')), ''));
  v_to := upper(nullif(btrim(coalesce(v_payload ->> 'toAvailability','')), ''));
  v_reason := nullif(btrim(coalesce(v_payload ->> 'reason','')), '');

  BEGIN
    v_hub_product_id := nullif(btrim(coalesce(v_payload ->> 'hubProductId','')), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_hub_product_id := null;
  END;

  BEGIN
    v_version := nullif(btrim(coalesce(v_payload ->> 'availabilityVersion','')), '')::bigint;
  EXCEPTION WHEN OTHERS THEN
    v_version := null;
  END;

  v_expected_to := CASE v_inbox.event_type
    WHEN 'product.reserve_requested' THEN 'RESERVED'
    WHEN 'product.release_requested' THEN 'IN_STOCK'
    WHEN 'product.mark_sold_requested' THEN 'SOLD'
    ELSE null
  END;

  IF v_inbox.source <> 'amphon-system'
     OR v_inbox.event_type NOT IN ('product.reserve_requested','product.release_requested','product.mark_sold_requested')
     OR v_inbox.entity_type <> 'product_intake_unit'
     OR v_identity_id IS NULL
     OR v_identity_id <> coalesce(v_inbox.entity_id,'')
     OR v_hub_product_id IS NULL
     OR v_sku IS NULL
     OR v_sku <> upper(coalesce(v_inbox.entity_sku,''))
     OR v_sku <> upper(coalesce(v_envelope #>> '{entity,sku}',''))
     OR v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'
     OR v_version IS NULL
     OR v_version < 1
     OR v_to IS NULL
     OR v_to <> v_expected_to
  THEN
    v_error := 'BRIDGE_AVAILABILITY_INVALID';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('one3c-source:' || v_identity_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('one3c-hub:' || v_hub_product_id::text, 0));

  SELECT * INTO v_link
  FROM public.external_entity_links
  WHERE source_system = 'amphon-system'
    AND source_entity_type = 'product_intake_unit'
    AND source_entity_id = v_identity_id
    AND target_system = 'product-hub'
    AND target_entity_type = 'product'
    AND target_entity_id = v_hub_product_id::text
    AND sync_status = 'LINKED'
    AND upper(coalesce(business_key,'')) = v_sku
  LIMIT 1;

  IF NOT FOUND THEN
    v_error := 'BRIDGE_AVAILABILITY_MAPPING_CONFLICT';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = v_hub_product_id
  FOR UPDATE;

  IF NOT FOUND
     OR upper(coalesce(v_product.sku,'')) <> v_sku
     OR NOT coalesce(v_product.one_managed,false)
     OR v_product.one_availability IS NULL
  THEN
    v_error := 'BRIDGE_AVAILABILITY_PRODUCT_CONFLICT';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  END IF;

  IF v_version < v_product.one_availability_version THEN
    UPDATE public.integration_event_inbox
    SET status = 'PROCESSED', processed_at = coalesce(processed_at,now()), last_error = null, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object(
      'outcome','STALE',
      'hubProductId',v_product.id::text,
      'sku',v_sku,
      'availability',v_product.one_availability,
      'availabilityVersion',v_product.one_availability_version
    );
  END IF;

  IF v_version = v_product.one_availability_version THEN
    IF v_to = v_product.one_availability THEN
      UPDATE public.integration_event_inbox
      SET status = 'PROCESSED', processed_at = coalesce(processed_at,now()), last_error = null, updated_at = now()
      WHERE id = v_inbox.id;
      RETURN jsonb_build_object(
        'outcome','DUPLICATE',
        'hubProductId',v_product.id::text,
        'sku',v_sku,
        'availability',v_product.one_availability,
        'availabilityVersion',v_product.one_availability_version
      );
    END IF;

    v_error := 'BRIDGE_AVAILABILITY_VERSION_CONFLICT';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  END IF;

  IF v_version <> v_product.one_availability_version + 1 THEN
    v_error := 'BRIDGE_AVAILABILITY_VERSION_GAP';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object(
      'outcome','CONFLICT','error',v_error,'sku',v_sku,
      'currentVersion',v_product.one_availability_version,'incomingVersion',v_version
    );
  END IF;

  IF v_from IS DISTINCT FROM v_product.one_availability THEN
    v_error := 'BRIDGE_AVAILABILITY_FROM_MISMATCH';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  END IF;

  IF NOT (
    (v_product.one_availability = 'IN_STOCK' AND v_to IN ('RESERVED','SOLD'))
    OR (v_product.one_availability = 'RESERVED' AND v_to IN ('IN_STOCK','SOLD'))
    OR (v_product.one_availability = 'SOLD' AND v_to = 'IN_STOCK')
  ) THEN
    v_error := 'BRIDGE_AVAILABILITY_TRANSITION_INVALID';
    UPDATE public.integration_event_inbox
    SET status = 'DEAD', last_error = v_error, updated_at = now()
    WHERE id = v_inbox.id;
    RETURN jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  END IF;

  IF v_to = 'RESERVED' THEN
    v_next_status := 'reserved';
  ELSIF v_to = 'SOLD' THEN
    v_next_status := 'sold';
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM public.product_publications pp
      WHERE pp.product_id = v_product.id AND pp.status = 'published'
    ) INTO v_has_publication;

    v_next_status := CASE
      WHEN v_has_publication THEN 'published'
      WHEN v_product.one_listing_readiness = 'READY_TO_LIST' THEN 'ready_to_list'
      WHEN coalesce(v_product.one_photos_complete,false) THEN 'photo_ready'
      ELSE 'draft'
    END;
  END IF;

  PERFORM set_config('amphon.one3_projection','on',true);

  UPDATE public.products
  SET one_availability = v_to,
      one_availability_version = v_version,
      one_availability_updated_at = now(),
      one_availability_last_event_id = p_event_id,
      one_availability_last_reason = coalesce(v_reason, v_inbox.event_type),
      status = v_next_status,
      sold_at = CASE
        WHEN v_to = 'SOLD' THEN coalesce(sold_at,now())
        WHEN v_from = 'SOLD' AND v_to = 'IN_STOCK' THEN null
        ELSE sold_at
      END
  WHERE id = v_product.id;

  UPDATE public.external_entity_links
  SET last_synced_at = now(), updated_at = now()
  WHERE id = v_link.id;

  v_ack_idempotency := 'availability:' || v_identity_id || ':v' || v_version::text || ':' || v_to || ':hub-ack';
  SELECT event_id INTO v_ack_event_id
  FROM public.integration_event_outbox
  WHERE destination = 'amphon-system'
    AND idempotency_key = v_ack_idempotency
  LIMIT 1;

  IF v_ack_event_id IS NULL THEN
    v_ack_event_id := gen_random_uuid();
    v_ack_payload := jsonb_build_object(
      'eventId', v_ack_event_id,
      'eventType', 'product.availability_changed',
      'version', 1,
      'source', 'product-hub',
      'occurredAt', now(),
      'idempotencyKey', v_ack_idempotency,
      'entity', jsonb_build_object('type','product','id',v_product.id::text,'sku',v_sku),
      'payload', jsonb_build_object(
        'hubProductId', v_product.id::text,
        'productIdentityId', v_identity_id,
        'sku', v_sku,
        'availability', v_to,
        'availabilityVersion', v_version,
        'sourceCommandEventId', p_event_id::text
      )
    );

    INSERT INTO public.integration_event_outbox (
      event_id, destination, event_type, version, idempotency_key,
      entity_type, entity_id, entity_sku, payload
    ) VALUES (
      v_ack_event_id, 'amphon-system', 'product.availability_changed', 1, v_ack_idempotency,
      'product', v_product.id::text, v_sku, v_ack_payload
    ) ON CONFLICT DO NOTHING;
  END IF;

  UPDATE public.integration_event_inbox
  SET status = 'PROCESSED',
      processed_at = coalesce(processed_at,now()),
      last_error = null,
      updated_at = now()
  WHERE id = v_inbox.id;

  RETURN jsonb_build_object(
    'outcome','APPLIED',
    'hubProductId',v_product.id::text,
    'productIdentityId',v_identity_id,
    'sku',v_sku,
    'availability',v_to,
    'availabilityVersion',v_version,
    'hubStatus',v_next_status,
    'ackEventId',v_ack_event_id::text
  );
END;
$$;

COMMENT ON FUNCTION public.one3c_consume_stock_event(uuid) IS
  'AMPHON ONE-3C System-authoritative stock projection consumer; supports SOLD -> IN_STOCK for inventory refunds/resale.';

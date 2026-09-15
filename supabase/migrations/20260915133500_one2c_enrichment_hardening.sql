-- ONE-2C hardening before production activation.
-- 1) If photos are the final workstream completed, synchronize legacy preparation status.
-- 2) Use the generated event UUID in the Outbox idempotency key so multiple readiness
--    transitions inside one database transaction cannot collapse into one stale snapshot.

create or replace function private.one2c_after_image_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_actor_id uuid;
  v_photo_count integer;
  v_has_cover boolean;
  v_complete boolean;
  v_old_complete boolean;
begin
  if tg_op = 'DELETE' then
    v_product_id := old.product_id;
    v_actor_id := coalesce((select auth.uid()), old.created_by);
  else
    v_product_id := new.product_id;
    v_actor_id := coalesce((select auth.uid()), new.created_by);
  end if;

  select count(*)::integer, coalesce(bool_or(is_cover), false)
  into v_photo_count, v_has_cover
  from public.product_images
  where product_id = v_product_id;

  v_complete := v_photo_count >= 2 and v_has_cover;

  select one_photos_complete
  into v_old_complete
  from public.products
  where id = v_product_id
    and one_managed = true;

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  update public.products
  set one_enrichment_started = true,
      one_photos_complete = v_complete,
      one_photos_completed_at = case
        when v_complete then coalesce(one_photos_completed_at, now())
        else null
      end,
      one_enrichment_updated_at = case
        when one_photos_complete is distinct from v_complete then now()
        else one_enrichment_updated_at
      end,
      status = case
        when v_complete
          and one_specs_complete
          and one_listing_content_complete
          and status in ('draft', 'photo_ready', 'ready_to_list')
          then 'ready_to_list'
        when v_complete
          and status in ('draft', 'photo_ready', 'ready_to_list')
          then 'photo_ready'
        when not v_complete
          and status in ('photo_ready', 'ready_to_list')
          then 'draft'
        else status
      end,
      updated_by = coalesce(v_actor_id, updated_by),
      updated_at = now()
  where id = v_product_id;

  if v_old_complete is distinct from v_complete then
    insert into public.activity_logs (actor_id, product_id, action, metadata)
    values (
      v_actor_id,
      v_product_id,
      'one_enrichment_photos_changed',
      jsonb_build_object(
        'complete', v_complete,
        'image_count', v_photo_count,
        'has_cover', v_has_cover,
        'source', 'one2c'
      )
    );
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.one2c_after_image_change() from public;

create or replace function private.one2c_after_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_event_id uuid;
  v_idempotency text;
  v_payload jsonb;
begin
  if not coalesce(new.one_managed, false) then
    return new;
  end if;

  if not (
    old.one_enrichment_started is distinct from new.one_enrichment_started
    or old.one_photos_complete is distinct from new.one_photos_complete
    or old.one_specs_complete is distinct from new.one_specs_complete
    or old.one_listing_content_complete is distinct from new.one_listing_content_complete
    or old.one_listing_readiness is distinct from new.one_listing_readiness
    or old.battery_health_grade is distinct from new.battery_health_grade
  ) then
    return new;
  end if;

  v_actor_id := coalesce((select auth.uid()), new.updated_by);
  v_event_id := gen_random_uuid();
  v_idempotency := 'product-enrichment:' || new.id::text || ':' || v_event_id::text || ':v1';

  v_payload := jsonb_build_object(
    'eventId', v_event_id,
    'eventType', 'product.enrichment_changed',
    'version', 1,
    'source', 'product-hub',
    'occurredAt', now(),
    'idempotencyKey', v_idempotency,
    'entity', jsonb_build_object('type', 'product', 'id', new.id::text, 'sku', new.sku),
    'actor', case when v_actor_id is null then null else jsonb_build_object('type', 'user', 'id', v_actor_id::text) end,
    'payload', jsonb_build_object(
      'hubProductId', new.id::text,
      'sku', new.sku,
      'listingReadiness', new.one_listing_readiness,
      'photosComplete', new.one_photos_complete,
      'specsComplete', new.one_specs_complete,
      'listingContentComplete', new.one_listing_content_complete,
      'batteryHealthGrade', new.battery_health_grade
    )
  );

  insert into public.integration_event_outbox (
    event_id,
    destination,
    event_type,
    version,
    idempotency_key,
    entity_type,
    entity_id,
    entity_sku,
    payload
  ) values (
    v_event_id,
    'amphon-system',
    'product.enrichment_changed',
    1,
    v_idempotency,
    'product',
    new.id::text,
    new.sku,
    v_payload
  );

  insert into public.activity_logs (actor_id, product_id, action, metadata)
  values (
    v_actor_id,
    new.id,
    'one_enrichment_changed',
    jsonb_build_object(
      'listing_readiness', new.one_listing_readiness,
      'photos_complete', new.one_photos_complete,
      'specs_complete', new.one_specs_complete,
      'listing_content_complete', new.one_listing_content_complete,
      'battery_health_grade', new.battery_health_grade,
      'source', 'one2c'
    )
  );

  return new;
end;
$$;

revoke all on function private.one2c_after_product_change() from public;

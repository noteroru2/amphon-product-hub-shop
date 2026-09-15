-- ONE-2D — Legacy Mapping Consumer
-- Source-only. Activation is deferred to ONE-PROD.
-- Exact identity/SKU linking only. This function never changes a Hub SKU,
-- never creates a replacement product, and never performs fuzzy matching.

create or replace function public.one2d_consume_legacy_link_event(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inbox public.integration_event_inbox%rowtype;
  v_envelope jsonb;
  v_payload jsonb;
  v_identity_id text;
  v_inventory_item_id text;
  v_hub_product_id uuid;
  v_sku text;
  v_product_sku text;
  v_existing public.external_entity_links%rowtype;
  v_ack_event_id uuid;
  v_ack_idempotency text;
  v_ack_payload jsonb;
  v_error text;
begin
  select * into v_inbox
  from public.integration_event_inbox
  where event_id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('outcome','NOT_FOUND','error','BRIDGE_INBOX_EVENT_NOT_FOUND');
  end if;

  if v_inbox.status = 'PROCESSED' then
    return jsonb_build_object('outcome','DUPLICATE','sku',v_inbox.entity_sku);
  end if;

  if v_inbox.status = 'DEAD' then
    return jsonb_build_object('outcome','DEAD','error',coalesce(v_inbox.last_error,'BRIDGE_EVENT_DEAD'));
  end if;

  update public.integration_event_inbox
  set status = 'PROCESSING', attempts = attempts + 1, last_error = null, updated_at = now()
  where id = v_inbox.id;

  v_envelope := v_inbox.payload;
  v_payload := v_envelope -> 'payload';
  v_identity_id := nullif(btrim(coalesce(v_payload ->> 'productIdentityId','')), '');
  v_inventory_item_id := nullif(btrim(coalesce(v_payload ->> 'inventoryItemId','')), '');
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));

  begin
    v_hub_product_id := nullif(btrim(coalesce(v_payload ->> 'hubProductId','')), '')::uuid;
  exception when others then
    v_hub_product_id := null;
  end;

  if v_inbox.source <> 'amphon-system'
     or v_inbox.event_type <> 'product.legacy_link_requested'
     or v_inbox.entity_type <> 'product_intake_unit'
     or v_identity_id is null
     or v_identity_id <> coalesce(v_inbox.entity_id,'')
     or v_hub_product_id is null
     or v_sku is null
     or v_sku <> upper(coalesce(v_inbox.entity_sku,''))
     or v_sku <> upper(coalesce(v_envelope #>> '{entity,sku}',''))
     or v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'
  then
    v_error := 'BRIDGE_LEGACY_LINK_INVALID';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('one2d-source:' || v_identity_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('one2d-hub:' || v_hub_product_id::text, 0));

  select sku into v_product_sku
  from public.products
  where id = v_hub_product_id
  limit 1;

  if v_product_sku is null then
    v_error := 'BRIDGE_LEGACY_HUB_PRODUCT_MISSING';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'hubProductId',v_hub_product_id::text);
  end if;

  if upper(v_product_sku) <> v_sku then
    v_error := 'BRIDGE_LEGACY_SKU_MISMATCH';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'hubProductId',v_hub_product_id::text,'sku',v_sku);
  end if;

  select * into v_existing
  from public.external_entity_links
  where (
    source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
    and source_entity_id = v_identity_id
    and target_system = 'product-hub'
    and target_entity_type = 'product'
  ) or (
    target_system = 'product-hub'
    and target_entity_type = 'product'
    and target_entity_id = v_hub_product_id::text
    and source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
  )
  order by created_at asc
  limit 1;

  if found then
    if v_existing.source_entity_id <> v_identity_id
       or v_existing.target_entity_id <> v_hub_product_id::text
       or upper(coalesce(v_existing.business_key,'')) <> v_sku
    then
      update public.external_entity_links
      set sync_status = 'CONFLICT', updated_at = now()
      where id = v_existing.id;
      v_error := 'BRIDGE_LEGACY_MAPPING_CONFLICT';
      update public.integration_event_inbox
      set status = 'DEAD', last_error = v_error, updated_at = now()
      where id = v_inbox.id;
      return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
    end if;

    update public.external_entity_links
    set sync_status = 'LINKED', last_synced_at = now(), updated_at = now()
    where id = v_existing.id;
  else
    insert into public.external_entity_links (
      source_system, source_entity_type, source_entity_id,
      target_system, target_entity_type, target_entity_id,
      business_key, sync_status, last_synced_at, metadata
    ) values (
      'amphon-system', 'product_intake_unit', v_identity_id,
      'product-hub', 'product', v_hub_product_id::text,
      v_sku, 'LINKED', now(),
      jsonb_build_object(
        'legacyAdopted', true,
        'inventoryItemId', v_inventory_item_id,
        'source', 'one2d'
      )
    );
  end if;

  v_ack_idempotency := 'legacy-link:' || v_identity_id || ':linked:v1';
  select event_id into v_ack_event_id
  from public.integration_event_outbox
  where destination = 'amphon-system'
    and idempotency_key = v_ack_idempotency
  limit 1;

  if v_ack_event_id is null then
    v_ack_event_id := gen_random_uuid();
    v_ack_payload := jsonb_build_object(
      'eventId', v_ack_event_id,
      'eventType', 'product.legacy_linked',
      'version', 1,
      'source', 'product-hub',
      'occurredAt', now(),
      'idempotencyKey', v_ack_idempotency,
      'entity', jsonb_build_object('type','product','id',v_hub_product_id::text,'sku',v_sku),
      'payload', jsonb_build_object(
        'hubProductId', v_hub_product_id::text,
        'productIdentityId', v_identity_id,
        'inventoryItemId', v_inventory_item_id,
        'sku', v_sku,
        'linkStatus', 'LINKED'
      )
    );

    insert into public.integration_event_outbox (
      event_id, destination, event_type, version, idempotency_key,
      entity_type, entity_id, entity_sku, payload
    ) values (
      v_ack_event_id, 'amphon-system', 'product.legacy_linked', 1, v_ack_idempotency,
      'product', v_hub_product_id::text, v_sku, v_ack_payload
    );
  end if;

  update public.integration_event_inbox
  set status = 'PROCESSED',
      processed_at = coalesce(processed_at, now()),
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  return jsonb_build_object(
    'outcome','LINKED',
    'hubProductId',v_hub_product_id::text,
    'productIdentityId',v_identity_id,
    'sku',v_sku,
    'ackEventId',v_ack_event_id::text
  );
end;
$$;

revoke all on function public.one2d_consume_legacy_link_event(uuid) from public;
revoke all on function public.one2d_consume_legacy_link_event(uuid) from anon, authenticated;
grant execute on function public.one2d_consume_legacy_link_event(uuid) to service_role;

comment on function public.one2d_consume_legacy_link_event(uuid) is
  'AMPHON ONE-2D server-only exact legacy identity-to-existing-Hub-product linker. Never mutates product SKU.';

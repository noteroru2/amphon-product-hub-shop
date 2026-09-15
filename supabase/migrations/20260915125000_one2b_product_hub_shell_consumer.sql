-- ONE-2B Product Hub Shell Consumer
-- Source-only migration. Do not activate the Worker consumer until production activation.
-- Consumes a durable product.intake_created inbox event and atomically:
-- 1) creates/reuses the exact Product Hub shell for the System-owned SKU,
-- 2) creates the System physical identity -> Hub product mapping,
-- 3) queues product.shell_created back to AMPHON System,
-- 4) marks the inbox event PROCESSED.

alter table public.products
  add column if not exists battery_health_grade text,
  add column if not exists one_managed boolean not null default false,
  add column if not exists one_intake_complete boolean not null default false,
  add column if not exists one_enrichment_started boolean not null default false,
  add column if not exists one_photos_complete boolean not null default false,
  add column if not exists one_specs_complete boolean not null default false,
  add column if not exists one_listing_content_complete boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_battery_health_grade_check'
  ) then
    alter table public.products
      add constraint products_battery_health_grade_check
      check (battery_health_grade is null or battery_health_grade in ('LOW','GOOD','VERY_GOOD','UNKNOWN'));
  end if;
end $$;

alter table public.products
  add column if not exists one_listing_readiness text
  generated always as (
    case
      when not one_managed then null
      when not one_intake_complete then 'INTAKE_ONLY'
      when not one_enrichment_started then 'INTAKE_ONLY'
      when one_photos_complete and one_specs_complete and one_listing_content_complete then 'READY_TO_LIST'
      when not one_photos_complete then 'PHOTO_PENDING'
      when not one_specs_complete then 'SPEC_PENDING'
      else 'LISTING_CONTENT_PENDING'
    end
  ) stored;

create index if not exists products_one_listing_readiness_idx
  on public.products (one_listing_readiness)
  where one_managed = true;

create or replace function public.one2b_consume_intake_event(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inbox public.integration_event_inbox%rowtype;
  v_envelope jsonb;
  v_payload jsonb;
  v_source_identity_id text;
  v_sku text;
  v_title text;
  v_category_raw text;
  v_category_code text;
  v_category text;
  v_serial text;
  v_battery_raw text;
  v_battery text;
  v_price numeric;
  v_product_id uuid;
  v_existing_sku text;
  v_link public.external_entity_links%rowtype;
  v_created boolean := false;
  v_ack_event_id uuid;
  v_ack_idempotency text;
  v_ack_payload jsonb;
  v_error text;
begin
  select *
  into v_inbox
  from public.integration_event_inbox
  where event_id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('outcome','NOT_FOUND','error','BRIDGE_INBOX_EVENT_NOT_FOUND');
  end if;

  if v_inbox.status = 'PROCESSED' then
    select *
    into v_link
    from public.external_entity_links
    where source_system = 'amphon-system'
      and source_entity_type = 'product_intake_unit'
      and source_entity_id = v_inbox.entity_id
      and target_system = 'product-hub'
      and target_entity_type = 'product'
    limit 1;

    if found then
      select sku
      into v_existing_sku
      from public.products
      where id::text = v_link.target_entity_id
      limit 1;
    end if;

    return jsonb_build_object(
      'outcome','DUPLICATE',
      'hubProductId',v_link.target_entity_id,
      'sku',coalesce(v_existing_sku, v_inbox.entity_sku),
      'listingReadiness','INTAKE_ONLY'
    );
  end if;

  if v_inbox.status = 'DEAD' then
    return jsonb_build_object('outcome','DEAD','error',coalesce(v_inbox.last_error,'BRIDGE_EVENT_DEAD'));
  end if;

  update public.integration_event_inbox
  set status = 'PROCESSING',
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  v_envelope := v_inbox.payload;
  v_payload := v_envelope -> 'payload';
  v_source_identity_id := nullif(btrim(coalesce(v_payload ->> 'productIdentityId','')), '');
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));
  v_title := nullif(btrim(coalesce(v_payload ->> 'name','')), '');

  if v_inbox.source <> 'amphon-system'
     or v_inbox.event_type <> 'product.intake_created'
     or v_inbox.entity_type <> 'product_intake_unit'
     or v_source_identity_id is null
     or v_title is null
     or v_sku is null
     or v_source_identity_id <> coalesce(v_inbox.entity_id,'')
     or v_sku <> upper(coalesce(v_inbox.entity_sku,''))
     or v_sku <> upper(coalesce(v_envelope #>> '{entity,sku}',''))
     or v_sku <> upper(coalesce(v_payload ->> 'qrPayload',''))
     or v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'
  then
    v_error := 'BRIDGE_INTAKE_INVALID';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('one2b-source:' || v_source_identity_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('one2b-sku:' || v_sku, 0));

  v_category_raw := lower(btrim(coalesce(v_payload ->> 'category','')));
  v_category_code := upper(btrim(coalesce(v_payload ->> 'categoryCode','')));

  if v_category_raw = any (array['notebook','pc','iphone','smartphone','tablet','camera','lens','monitor','component','gaming','accessory','other']) then
    v_category := v_category_raw;
  else
    v_category := case v_category_code
      when 'NB' then 'notebook'
      when 'PH' then 'smartphone'
      when 'TB' then 'tablet'
      when 'PC' then 'pc'
      when 'CM' then 'camera'
      when 'CP' then 'component'
      when 'GM' then 'gaming'
      when 'MN' then 'monitor'
      else 'other'
    end;
  end if;

  v_serial := nullif(btrim(coalesce(v_payload ->> 'serialNumber','')), '');
  v_battery_raw := upper(btrim(coalesce(v_payload ->> 'batteryHealthGrade','')));
  v_battery := case
    when v_battery_raw in ('LOW','ต่ำ') then 'LOW'
    when v_battery_raw in ('GOOD','ดี') then 'GOOD'
    when v_battery_raw in ('VERY_GOOD','ดีมาก') then 'VERY_GOOD'
    when v_battery_raw in ('UNKNOWN','ไม่ทราบ') then 'UNKNOWN'
    else null
  end;

  if nullif(btrim(coalesce(v_payload ->> 'targetPrice','')), '') ~ '^[0-9]+([.][0-9]+)?$' then
    v_price := (v_payload ->> 'targetPrice')::numeric;
  else
    v_price := null;
  end if;

  select *
  into v_link
  from public.external_entity_links
  where source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
    and source_entity_id = v_source_identity_id
    and target_system = 'product-hub'
    and target_entity_type = 'product'
  limit 1;

  if found then
    select id, sku into v_product_id, v_existing_sku
    from public.products
    where id::text = v_link.target_entity_id
    limit 1;

    if v_product_id is null or upper(coalesce(v_existing_sku,'')) <> v_sku then
      v_error := 'BRIDGE_MAPPING_CONFLICT';
      update public.external_entity_links
      set sync_status = 'CONFLICT', updated_at = now()
      where id = v_link.id;
      update public.integration_event_inbox
      set status = 'DEAD', last_error = v_error, updated_at = now()
      where id = v_inbox.id;
      return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
    end if;
  else
    select id, sku into v_product_id, v_existing_sku
    from public.products
    where sku = v_sku
    limit 1;

    if v_product_id is not null then
      v_error := 'BRIDGE_SKU_CONFLICT';
      update public.integration_event_inbox
      set status = 'DEAD', last_error = v_error, updated_at = now()
      where id = v_inbox.id;
      return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku,'hubProductId',v_product_id);
    end if;

    insert into public.products (
      sku, category, brand, model, title, serial_number, status, price, specs,
      battery_health_grade, one_managed, one_intake_complete,
      one_enrichment_started, one_photos_complete, one_specs_complete,
      one_listing_content_complete
    ) values (
      v_sku,
      v_category,
      nullif(btrim(coalesce(v_payload ->> 'brand','')), ''),
      nullif(btrim(coalesce(v_payload ->> 'model','')), ''),
      v_title,
      v_serial,
      'draft',
      v_price,
      '{}'::jsonb,
      v_battery,
      true,
      true,
      false,
      false,
      false,
      false
    )
    returning id into v_product_id;

    v_created := true;

    insert into public.external_entity_links (
      source_system, source_entity_type, source_entity_id,
      target_system, target_entity_type, target_entity_id,
      business_key, sync_status, last_synced_at, metadata
    ) values (
      'amphon-system',
      'product_intake_unit',
      v_source_identity_id,
      'product-hub',
      'product',
      v_product_id::text,
      v_sku,
      'LINKED',
      now(),
      jsonb_build_object(
        'systemIntakeId', v_payload ->> 'systemIntakeId',
        'inventoryItemId', v_payload ->> 'inventoryItemId',
        'unitOrdinal', v_payload ->> 'unitOrdinal',
        'quantityInIntake', v_payload ->> 'quantityInIntake',
        'qrPayload', v_payload ->> 'qrPayload'
      )
    );
  end if;

  v_ack_idempotency := 'product-shell:' || v_source_identity_id || ':created:v1';
  select event_id into v_ack_event_id
  from public.integration_event_outbox
  where destination = 'amphon-system'
    and idempotency_key = v_ack_idempotency
  limit 1;

  if v_ack_event_id is null then
    v_ack_event_id := gen_random_uuid();
    v_ack_payload := jsonb_build_object(
      'eventId', v_ack_event_id,
      'eventType', 'product.shell_created',
      'version', 1,
      'source', 'product-hub',
      'occurredAt', now(),
      'idempotencyKey', v_ack_idempotency,
      'entity', jsonb_build_object('type','product','id',v_product_id::text,'sku',v_sku),
      'payload', jsonb_build_object(
        'hubProductId', v_product_id::text,
        'productIdentityId', v_source_identity_id,
        'inventoryItemId', v_payload ->> 'inventoryItemId',
        'sku', v_sku,
        'listingReadiness', 'INTAKE_ONLY'
      )
    );

    insert into public.integration_event_outbox (
      event_id, destination, event_type, version, idempotency_key,
      entity_type, entity_id, entity_sku, payload
    ) values (
      v_ack_event_id,
      'amphon-system',
      'product.shell_created',
      1,
      v_ack_idempotency,
      'product',
      v_product_id::text,
      v_sku,
      v_ack_payload
    );
  end if;

  update public.external_entity_links
  set sync_status = 'LINKED', last_synced_at = now(), updated_at = now()
  where source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
    and source_entity_id = v_source_identity_id
    and target_system = 'product-hub'
    and target_entity_type = 'product';

  update public.integration_event_inbox
  set status = 'PROCESSED',
      processed_at = coalesce(processed_at, now()),
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  return jsonb_build_object(
    'outcome', case when v_created then 'CREATED' else 'DUPLICATE' end,
    'hubProductId', v_product_id::text,
    'sku', v_sku,
    'listingReadiness', 'INTAKE_ONLY',
    'ackEventId', v_ack_event_id::text
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.one2b_consume_intake_event(uuid) from public;
revoke all on function public.one2b_consume_intake_event(uuid) from anon, authenticated;
grant execute on function public.one2b_consume_intake_event(uuid) to service_role;

comment on function public.one2b_consume_intake_event(uuid) is
  'AMPHON ONE-2B server-only transactional Product Hub shell consumer for product.intake_created.';
comment on column public.products.one_listing_readiness is
  'AMPHON ONE derived listing readiness. Legacy products remain NULL until one_managed=true.';
comment on column public.products.battery_health_grade is
  'Simple battery grade: LOW, GOOD, VERY_GOOD, UNKNOWN; percentage is intentionally not required.';

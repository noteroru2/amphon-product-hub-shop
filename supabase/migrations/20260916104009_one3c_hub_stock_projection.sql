-- AMPHON ONE-3C — Product Hub canonical availability projection consumer
-- System remains the stock/sale authority. Hub stores a versioned projection only.
-- This migration does NOT activate the Worker consumer; rollout remains fail-closed.

alter table public.products
  add column if not exists one_availability text,
  add column if not exists one_availability_version bigint not null default 0,
  add column if not exists one_availability_updated_at timestamptz,
  add column if not exists one_availability_last_event_id uuid,
  add column if not exists one_availability_last_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_one_availability_check'
  ) then
    alter table public.products
      add constraint products_one_availability_check
      check (one_availability is null or one_availability in ('IN_STOCK','RESERVED','SOLD','REPAIR','RETURNED','WRITTEN_OFF'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_one_availability_version_check'
  ) then
    alter table public.products
      add constraint products_one_availability_version_check
      check (one_availability_version >= 0);
  end if;
end $$;

create index if not exists products_one_availability_idx
  on public.products(one_availability)
  where one_managed = true;

-- Establish Hub-side version-0 projection from current legacy status.
-- This is a baseline only and emits no integration events.
update public.products
set one_availability = case status
      when 'reserved' then 'RESERVED'
      when 'sold' then 'SOLD'
      when 'repair' then 'REPAIR'
      when 'returned' then 'RETURNED'
      when 'cancelled' then 'WRITTEN_OFF'
      else 'IN_STOCK'
    end,
    one_availability_version = 0,
    one_availability_updated_at = coalesce(one_availability_updated_at, now()),
    one_availability_last_reason = coalesce(one_availability_last_reason, 'ONE3_BASELINE')
where one_managed = true
  and one_availability is null;

-- Existing status transition guard remains for legacy Hub workflow, but a server-side
-- ONE projection may cross legacy-status edges (for example draft -> sold) when the
-- transaction-local projection marker is present.
create or replace function public.guard_product_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  role_name text;
  allowed boolean := false;
begin
  if new.status = old.status then
    return new;
  end if;

  if coalesce(old.one_managed, false)
     and current_user in ('service_role','postgres')
     and coalesce(current_setting('amphon.one3_projection', true), '') = 'on'
  then
    return new;
  end if;

  role_name := public.current_user_role();

  allowed := case old.status
    when 'draft' then new.status in ('photo_ready','ready_to_list','repair','consignment','cancelled')
    when 'photo_ready' then new.status in ('draft','ready_to_list','repair','consignment','cancelled')
    when 'ready_to_list' then new.status in ('draft','photo_ready','published','reserved','sold','repair','consignment','cancelled')
    when 'published' then new.status in ('ready_to_list','reserved','sold','repair','cancelled')
    when 'reserved' then new.status in ('ready_to_list','published','sold','cancelled')
    when 'sold' then new.status in ('returned')
    when 'repair' then new.status in ('draft','photo_ready','ready_to_list','consignment','cancelled')
    when 'consignment' then new.status in ('draft','photo_ready','ready_to_list','published','reserved','sold','returned','cancelled')
    when 'returned' then new.status = 'draft' and role_name in ('owner','admin')
    when 'cancelled' then new.status = 'draft' and role_name in ('owner','admin')
    else false
  end;

  if not allowed then
    raise exception 'INVALID_STATUS_TRANSITION:%->%', old.status, new.status;
  end if;

  return new;
end;
$$;

create or replace function private.one3c_guard_one_managed_availability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not coalesce(old.one_managed, false) or new.status = old.status then
    return new;
  end if;

  if current_user = 'postgres' then
    return new;
  end if;

  if current_user = 'service_role'
     and coalesce(current_setting('amphon.one3_projection', true), '') = 'on'
  then
    return new;
  end if;

  if old.status in ('reserved','sold','repair','returned','cancelled')
     or new.status in ('reserved','sold','repair','returned','cancelled')
  then
    raise exception 'ONE_MANAGED_AVAILABILITY_SYSTEM_OWNED';
  end if;

  return new;
end;
$$;

revoke all on function private.one3c_guard_one_managed_availability() from public;

drop trigger if exists trg_one3c_guard_one_managed_availability on public.products;
create trigger trg_one3c_guard_one_managed_availability
before update of status on public.products
for each row
execute function private.one3c_guard_one_managed_availability();

create or replace function public.one3c_consume_stock_event(p_event_id uuid)
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
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));
  v_from := upper(nullif(btrim(coalesce(v_payload ->> 'fromAvailability','')), ''));
  v_to := upper(nullif(btrim(coalesce(v_payload ->> 'toAvailability','')), ''));
  v_reason := nullif(btrim(coalesce(v_payload ->> 'reason','')), '');

  begin
    v_hub_product_id := nullif(btrim(coalesce(v_payload ->> 'hubProductId','')), '')::uuid;
  exception when others then
    v_hub_product_id := null;
  end;

  begin
    v_version := nullif(btrim(coalesce(v_payload ->> 'availabilityVersion','')), '')::bigint;
  exception when others then
    v_version := null;
  end;

  v_expected_to := case v_inbox.event_type
    when 'product.reserve_requested' then 'RESERVED'
    when 'product.release_requested' then 'IN_STOCK'
    when 'product.mark_sold_requested' then 'SOLD'
    else null
  end;

  if v_inbox.source <> 'amphon-system'
     or v_inbox.event_type not in ('product.reserve_requested','product.release_requested','product.mark_sold_requested')
     or v_inbox.entity_type <> 'product_intake_unit'
     or v_identity_id is null
     or v_identity_id <> coalesce(v_inbox.entity_id,'')
     or v_hub_product_id is null
     or v_sku is null
     or v_sku <> upper(coalesce(v_inbox.entity_sku,''))
     or v_sku <> upper(coalesce(v_envelope #>> '{entity,sku}',''))
     or v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'
     or v_version is null
     or v_version < 1
     or v_to is null
     or v_to <> v_expected_to
  then
    v_error := 'BRIDGE_AVAILABILITY_INVALID';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('one3c-source:' || v_identity_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('one3c-hub:' || v_hub_product_id::text, 0));

  select * into v_link
  from public.external_entity_links
  where source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
    and source_entity_id = v_identity_id
    and target_system = 'product-hub'
    and target_entity_type = 'product'
    and target_entity_id = v_hub_product_id::text
    and sync_status = 'LINKED'
    and upper(coalesce(business_key,'')) = v_sku
  limit 1;

  if not found then
    v_error := 'BRIDGE_AVAILABILITY_MAPPING_CONFLICT';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  select * into v_product
  from public.products
  where id = v_hub_product_id
  for update;

  if not found
     or upper(coalesce(v_product.sku,'')) <> v_sku
     or not coalesce(v_product.one_managed,false)
     or v_product.one_availability is null
  then
    v_error := 'BRIDGE_AVAILABILITY_PRODUCT_CONFLICT';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if v_version < v_product.one_availability_version then
    update public.integration_event_inbox
    set status = 'PROCESSED', processed_at = coalesce(processed_at,now()), last_error = null, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object(
      'outcome','STALE',
      'hubProductId',v_product.id::text,
      'sku',v_sku,
      'availability',v_product.one_availability,
      'availabilityVersion',v_product.one_availability_version
    );
  end if;

  if v_version = v_product.one_availability_version then
    if v_to = v_product.one_availability then
      update public.integration_event_inbox
      set status = 'PROCESSED', processed_at = coalesce(processed_at,now()), last_error = null, updated_at = now()
      where id = v_inbox.id;
      return jsonb_build_object(
        'outcome','DUPLICATE',
        'hubProductId',v_product.id::text,
        'sku',v_sku,
        'availability',v_product.one_availability,
        'availabilityVersion',v_product.one_availability_version
      );
    end if;

    v_error := 'BRIDGE_AVAILABILITY_VERSION_CONFLICT';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if v_version <> v_product.one_availability_version + 1 then
    v_error := 'BRIDGE_AVAILABILITY_VERSION_GAP';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object(
      'outcome','CONFLICT','error',v_error,'sku',v_sku,
      'currentVersion',v_product.one_availability_version,'incomingVersion',v_version
    );
  end if;

  if v_from is distinct from v_product.one_availability then
    v_error := 'BRIDGE_AVAILABILITY_FROM_MISMATCH';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if not (
    (v_product.one_availability = 'IN_STOCK' and v_to in ('RESERVED','SOLD'))
    or (v_product.one_availability = 'RESERVED' and v_to in ('IN_STOCK','SOLD'))
  ) then
    v_error := 'BRIDGE_AVAILABILITY_TRANSITION_INVALID';
    update public.integration_event_inbox
    set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if v_to = 'RESERVED' then
    v_next_status := 'reserved';
  elsif v_to = 'SOLD' then
    v_next_status := 'sold';
  else
    select exists(
      select 1 from public.product_publications pp
      where pp.product_id = v_product.id and pp.status = 'published'
    ) into v_has_publication;

    v_next_status := case
      when v_has_publication then 'published'
      when v_product.one_listing_readiness = 'READY_TO_LIST' then 'ready_to_list'
      when coalesce(v_product.one_photos_complete,false) then 'photo_ready'
      else 'draft'
    end;
  end if;

  perform set_config('amphon.one3_projection','on',true);

  update public.products
  set one_availability = v_to,
      one_availability_version = v_version,
      one_availability_updated_at = now(),
      one_availability_last_event_id = p_event_id,
      one_availability_last_reason = coalesce(v_reason, v_inbox.event_type),
      status = v_next_status,
      sold_at = case when v_to = 'SOLD' then coalesce(sold_at,now()) else sold_at end
  where id = v_product.id;

  update public.external_entity_links
  set last_synced_at = now(), updated_at = now()
  where id = v_link.id;

  v_ack_idempotency := 'availability:' || v_identity_id || ':v' || v_version::text || ':' || v_to || ':hub-ack';
  select event_id into v_ack_event_id
  from public.integration_event_outbox
  where destination = 'amphon-system'
    and idempotency_key = v_ack_idempotency
  limit 1;

  if v_ack_event_id is null then
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

    insert into public.integration_event_outbox (
      event_id, destination, event_type, version, idempotency_key,
      entity_type, entity_id, entity_sku, payload
    ) values (
      v_ack_event_id, 'amphon-system', 'product.availability_changed', 1, v_ack_idempotency,
      'product', v_product.id::text, v_sku, v_ack_payload
    ) on conflict do nothing;
  end if;

  update public.integration_event_inbox
  set status = 'PROCESSED',
      processed_at = coalesce(processed_at,now()),
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  return jsonb_build_object(
    'outcome','APPLIED',
    'hubProductId',v_product.id::text,
    'productIdentityId',v_identity_id,
    'sku',v_sku,
    'availability',v_to,
    'availabilityVersion',v_version,
    'hubStatus',v_next_status,
    'ackEventId',v_ack_event_id::text
  );
end;
$$;

revoke all on function public.one3c_consume_stock_event(uuid) from public;
revoke all on function public.one3c_consume_stock_event(uuid) from anon, authenticated;
grant execute on function public.one3c_consume_stock_event(uuid) to service_role;

comment on function public.one3c_consume_stock_event(uuid) is
  'AMPHON ONE-3C server-only versioned System-authoritative stock projection consumer for ONE-managed products.';

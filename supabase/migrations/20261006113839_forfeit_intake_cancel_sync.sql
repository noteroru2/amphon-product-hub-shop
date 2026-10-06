-- FORFEIT intake cancellation sync
-- When AMPHON System reverts a forfeited contract, preserve the immutable ONE identity
-- and project the item to WRITTEN_OFF / cancelled in Product Hub.

create or replace function public.one2b_consume_intake_cancel_event(p_event_id uuid)
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
  v_sku text;
  v_from text;
  v_to text;
  v_reason text;
  v_version bigint;
  v_link public.external_entity_links%rowtype;
  v_product public.products%rowtype;
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
    return jsonb_build_object(
      'outcome','DUPLICATE',
      'sku',v_inbox.entity_sku
    );
  end if;

  if v_inbox.status = 'DEAD' then
    return jsonb_build_object(
      'outcome','DEAD',
      'error',coalesce(v_inbox.last_error,'BRIDGE_EVENT_DEAD'),
      'sku',v_inbox.entity_sku
    );
  end if;

  update public.integration_event_inbox
  set status = 'PROCESSING',
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  v_envelope := v_inbox.payload;
  v_payload := v_envelope -> 'payload';
  v_identity_id := nullif(btrim(coalesce(v_payload ->> 'productIdentityId','')), '');
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));
  v_from := upper(nullif(btrim(coalesce(v_payload ->> 'fromAvailability','')), ''));
  v_to := upper(nullif(btrim(coalesce(v_payload ->> 'toAvailability','')), ''));
  v_reason := nullif(btrim(coalesce(v_payload ->> 'reason','')), '');

  begin
    v_version := nullif(btrim(coalesce(v_payload ->> 'availabilityVersion','')), '')::bigint;
  exception when others then
    v_version := null;
  end;

  if v_inbox.source <> 'amphon-system'
     or v_inbox.event_type <> 'product.intake_cancelled'
     or v_inbox.entity_type <> 'product_intake_unit'
     or v_identity_id is null
     or v_identity_id <> coalesce(v_inbox.entity_id,'')
     or v_sku is null
     or v_sku <> upper(coalesce(v_inbox.entity_sku,''))
     or v_sku <> upper(coalesce(v_envelope #>> '{entity,sku}',''))
     or v_sku !~ '^AT-[A-Z0-9]{2,4}-[0-9]{4}-[0-9]{6}$'
     or v_from <> 'IN_STOCK'
     or v_to <> 'WRITTEN_OFF'
     or v_version is null
     or v_version < 1
  then
    v_error := 'BRIDGE_INTAKE_CANCEL_INVALID';
    update public.integration_event_inbox
    set status = 'DEAD',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('one2b-cancel-source:' || v_identity_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('one2b-cancel-sku:' || v_sku, 0));

  select *
  into v_link
  from public.external_entity_links
  where source_system = 'amphon-system'
    and source_entity_type = 'product_intake_unit'
    and source_entity_id = v_identity_id
    and target_system = 'product-hub'
    and target_entity_type = 'product'
  limit 1;

  if not found then
    v_error := 'INTAKE_CANCEL_MAPPING_NOT_READY';
    update public.integration_event_inbox
    set status = 'FAILED',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','RETRY','error',v_error,'sku',v_sku);
  end if;

  select *
  into v_product
  from public.products
  where id::text = v_link.target_entity_id
  for update;

  if not found
     or upper(coalesce(v_product.sku,'')) <> v_sku
     or not coalesce(v_product.one_managed,false)
  then
    v_error := 'BRIDGE_INTAKE_CANCEL_MAPPING_CONFLICT';
    update public.external_entity_links
    set sync_status = 'CONFLICT',
        updated_at = now()
    where id = v_link.id;

    update public.integration_event_inbox
    set status = 'DEAD',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;

    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if v_product.one_availability is null then
    v_error := 'INTAKE_CANCEL_AVAILABILITY_NOT_READY';
    update public.integration_event_inbox
    set status = 'FAILED',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object(
      'outcome','RETRY',
      'error',v_error,
      'hubProductId',v_product.id::text,
      'sku',v_sku
    );
  end if;

  if v_version < v_product.one_availability_version then
    update public.integration_event_inbox
    set status = 'PROCESSED',
        processed_at = coalesce(processed_at,now()),
        last_error = null,
        updated_at = now()
    where id = v_inbox.id;

    return jsonb_build_object(
      'outcome','STALE',
      'hubProductId',v_product.id::text,
      'sku',v_sku,
      'availability',v_product.one_availability,
      'availabilityVersion',v_product.one_availability_version,
      'hubStatus',v_product.status
    );
  end if;

  if v_version = v_product.one_availability_version then
    if v_product.one_availability = 'WRITTEN_OFF' and v_product.status = 'cancelled' then
      update public.integration_event_inbox
      set status = 'PROCESSED',
          processed_at = coalesce(processed_at,now()),
          last_error = null,
          updated_at = now()
      where id = v_inbox.id;

      return jsonb_build_object(
        'outcome','DUPLICATE',
        'hubProductId',v_product.id::text,
        'sku',v_sku,
        'availability','WRITTEN_OFF',
        'availabilityVersion',v_product.one_availability_version,
        'hubStatus','cancelled'
      );
    end if;

    v_error := 'BRIDGE_INTAKE_CANCEL_VERSION_CONFLICT';
    update public.integration_event_inbox
    set status = 'DEAD',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  if v_version <> v_product.one_availability_version + 1 then
    v_error := 'BRIDGE_INTAKE_CANCEL_VERSION_GAP';
    update public.integration_event_inbox
    set status = 'DEAD',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object(
      'outcome','CONFLICT',
      'error',v_error,
      'sku',v_sku,
      'currentVersion',v_product.one_availability_version,
      'incomingVersion',v_version
    );
  end if;

  if upper(coalesce(v_product.one_availability,'')) <> v_from then
    v_error := 'BRIDGE_INTAKE_CANCEL_FROM_MISMATCH';
    update public.integration_event_inbox
    set status = 'DEAD',
        last_error = v_error,
        updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object(
      'outcome','CONFLICT',
      'error',v_error,
      'sku',v_sku,
      'currentAvailability',v_product.one_availability,
      'incomingFrom',v_from
    );
  end if;

  perform set_config('amphon.one3_projection','on',true);

  update public.products
  set one_availability = 'WRITTEN_OFF',
      one_availability_version = v_version,
      one_availability_updated_at = now(),
      one_availability_last_event_id = p_event_id,
      one_availability_last_reason = coalesce(v_reason,'REVERT_FORFEIT'),
      status = 'cancelled',
      sold_at = null
  where id = v_product.id;

  update public.external_entity_links
  set last_synced_at = now(),
      sync_status = 'LINKED',
      updated_at = now()
  where id = v_link.id;

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
    'availability','WRITTEN_OFF',
    'availabilityVersion',v_version,
    'hubStatus','cancelled'
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.one2b_consume_intake_cancel_event(uuid) from public;
revoke all on function public.one2b_consume_intake_cancel_event(uuid) from anon, authenticated;
grant execute on function public.one2b_consume_intake_cancel_event(uuid) to service_role;

comment on function public.one2b_consume_intake_cancel_event(uuid) is
  'AMPHON ONE server-only consumer for reverting a System forfeiture after its Product Hub shell was created.';

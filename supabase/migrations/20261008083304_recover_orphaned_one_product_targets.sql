-- Recover ONE mappings whose Product Hub target row was deleted.
-- Restore the exact historical Hub UUID from external_entity_links so AMPHON System
-- does not need a mapping rewrite. Source fields come only from the original
-- product.intake_created envelope; current availability/pricing are projected from
-- the latest System events. Applied to production as migration 20261008083304.

create or replace function public.repair_one_orphaned_product(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_link public.external_entity_links%rowtype;
  v_intake public.integration_event_inbox%rowtype;
  v_stock public.integration_event_inbox%rowtype;
  v_price public.integration_event_inbox%rowtype;
  v_payload jsonb;
  v_stock_payload jsonb;
  v_price_payload jsonb;
  v_product_id uuid;
  v_sku text;
  v_title text;
  v_category_raw text;
  v_category_code text;
  v_category text;
  v_serial text;
  v_battery_raw text;
  v_battery text;
  v_target_price numeric;
  v_retail numeric;
  v_availability text := 'IN_STOCK';
  v_availability_version bigint := 0;
  v_status text := 'draft';
  v_sold_at timestamptz;
  v_recovered_failures int := 0;
begin
  select * into v_link
  from public.external_entity_links
  where id=p_link_id
  for update;

  if not found then
    return jsonb_build_object('outcome','NOT_FOUND');
  end if;

  if v_link.source_system <> 'amphon-system'
     or v_link.source_entity_type <> 'product_intake_unit'
     or v_link.target_system <> 'product-hub'
     or v_link.target_entity_type <> 'product'
  then
    return jsonb_build_object('outcome','SKIPPED','reason','NOT_ONE_PRODUCT_LINK');
  end if;

  begin
    v_product_id := v_link.target_entity_id::uuid;
  exception when others then
    return jsonb_build_object('outcome','CONFLICT','reason','TARGET_ID_NOT_UUID');
  end;

  if exists(select 1 from public.products where id=v_product_id) then
    update public.external_entity_links
      set sync_status='LINKED', last_synced_at=now(), updated_at=now()
    where id=v_link.id;
    return jsonb_build_object('outcome','ALREADY_PRESENT','productId',v_product_id,'sku',v_link.business_key);
  end if;

  select * into v_intake
  from public.integration_event_inbox
  where source='amphon-system'
    and event_type='product.intake_created'
    and entity_type='product_intake_unit'
    and entity_id=v_link.source_entity_id
  order by received_at asc
  limit 1;

  if not found then
    return jsonb_build_object('outcome','CONFLICT','reason','SOURCE_INTAKE_EVENT_MISSING','sku',v_link.business_key);
  end if;

  v_payload := v_intake.payload -> 'payload';
  v_sku := upper(nullif(btrim(coalesce(v_payload->>'sku',v_intake.entity_sku,v_link.business_key,'')),''));
  v_title := nullif(btrim(coalesce(v_payload->>'name','')),'');
  if v_sku is null or v_title is null or v_sku <> upper(coalesce(v_link.business_key,'')) then
    return jsonb_build_object('outcome','CONFLICT','reason','SOURCE_INTAKE_PAYLOAD_INVALID','sku',v_link.business_key);
  end if;

  v_category_raw := lower(btrim(coalesce(v_payload->>'category','')));
  v_category_code := upper(btrim(coalesce(v_payload->>'categoryCode','')));
  if v_category_raw = any(array['notebook','pc','iphone','smartphone','tablet','camera','lens','monitor','component','gaming','accessory','other']) then
    v_category := v_category_raw;
  else
    v_category := case v_category_code
      when 'NB' then 'notebook'
      when 'PH' then 'smartphone'
      when 'TB' then 'tablet'
      when 'PC' then 'pc'
      when 'CM' then 'camera'
      when 'CAM' then 'camera'
      when 'CP' then 'component'
      when 'GM' then 'gaming'
      when 'MN' then 'monitor'
      when 'MON' then 'monitor'
      else 'other'
    end;
  end if;

  v_serial := nullif(btrim(coalesce(v_payload->>'serialNumber','')),'');
  v_battery_raw := upper(btrim(coalesce(v_payload->>'batteryHealthGrade','')));
  v_battery := case
    when v_battery_raw in ('LOW','ต่ำ') then 'LOW'
    when v_battery_raw in ('GOOD','ดี') then 'GOOD'
    when v_battery_raw in ('VERY_GOOD','ดีมาก') then 'VERY_GOOD'
    when v_battery_raw in ('UNKNOWN','ไม่ทราบ') then 'UNKNOWN'
    else null
  end;
  if nullif(btrim(coalesce(v_payload->>'targetPrice','')),'') ~ '^[0-9]+([.][0-9]+)?$' then
    v_target_price := (v_payload->>'targetPrice')::numeric;
  end if;

  select * into v_stock
  from public.integration_event_inbox i
  where i.source='amphon-system'
    and i.entity_type='product_intake_unit'
    and i.entity_id=v_link.source_entity_id
    and i.event_type in ('product.reserve_requested','product.release_requested','product.mark_sold_requested')
    and nullif(i.payload #>> '{payload,availabilityVersion}','') ~ '^[0-9]+$'
  order by (i.payload #>> '{payload,availabilityVersion}')::bigint desc, i.received_at desc
  limit 1;

  if found then
    v_stock_payload := v_stock.payload -> 'payload';
    v_availability := upper(coalesce(nullif(v_stock_payload->>'toAvailability',''),'IN_STOCK'));
    v_availability_version := coalesce(nullif(v_stock_payload->>'availabilityVersion','')::bigint,0);
    if v_availability not in ('IN_STOCK','RESERVED','SOLD','REPAIR','RETURNED','WRITTEN_OFF') then
      v_availability := 'IN_STOCK';
      v_availability_version := 0;
    end if;
  end if;

  v_status := case v_availability
    when 'SOLD' then 'sold'
    when 'RESERVED' then 'reserved'
    when 'REPAIR' then 'repair'
    when 'RETURNED' then 'returned'
    when 'WRITTEN_OFF' then 'cancelled'
    else 'draft'
  end;
  if v_availability='SOLD' then
    v_sold_at := coalesce(v_stock.received_at,now());
  end if;

  select * into v_price
  from public.integration_event_inbox i
  where i.source='amphon-system'
    and i.entity_type='product_intake_unit'
    and i.entity_id=v_link.source_entity_id
    and i.event_type='product.pricing_changed'
  order by i.received_at desc
  limit 1;

  if found then
    v_price_payload := v_price.payload -> 'payload';
    if nullif(v_price_payload->>'retailPrice','') ~ '^[0-9]+([.][0-9]+)?$' then
      v_retail := (v_price_payload->>'retailPrice')::numeric;
    end if;
  end if;

  perform set_config('amphon.one3_projection','on',true);

  insert into public.products(
    id,sku,category,brand,model,title,serial_number,status,price,specs,
    battery_health_grade,one_managed,one_intake_complete,
    one_enrichment_started,one_photos_complete,one_specs_complete,
    one_listing_content_complete,
    one_availability,one_availability_version,one_availability_updated_at,
    one_availability_last_event_id,one_availability_last_reason,sold_at,
    one_retail_price,one_quick_sale_price,one_dealer_price,one_absolute_floor_price,
    one_stock_age_days,one_aging_bucket,one_dealer_eligibility,one_price_strategy,
    one_turnover_rule_version,one_turnover_rule_cohort,one_pricing_updated_at,
    one_pricing_last_event_id
  ) values (
    v_product_id,v_sku,v_category,
    nullif(btrim(coalesce(v_payload->>'brand','')),''),
    nullif(btrim(coalesce(v_payload->>'model','')),''),
    v_title,v_serial,v_status,coalesce(v_retail,v_target_price),'{}'::jsonb,
    v_battery,true,true,false,false,false,false,
    v_availability,v_availability_version,now(),
    case when v_stock.id is not null then v_stock.event_id else null end,
    'ORPHAN_TARGET_RECOVERY',v_sold_at,
    v_retail,
    case when v_price.id is not null and nullif(v_price_payload->>'quickSalePrice','') ~ '^[0-9]+([.][0-9]+)?$' then (v_price_payload->>'quickSalePrice')::numeric else null end,
    case when v_price.id is not null and nullif(v_price_payload->>'dealerPrice','') ~ '^[0-9]+([.][0-9]+)?$' then (v_price_payload->>'dealerPrice')::numeric else null end,
    case when v_price.id is not null and nullif(v_price_payload->>'absoluteFloorPrice','') ~ '^[0-9]+([.][0-9]+)?$' then (v_price_payload->>'absoluteFloorPrice')::numeric else null end,
    case when v_price.id is not null and nullif(v_price_payload->>'stockAgeDays','') ~ '^[0-9]+$' then (v_price_payload->>'stockAgeDays')::integer else 0 end,
    case when v_price.id is not null then nullif(v_price_payload->>'agingBucket','') else null end,
    case when v_price.id is not null then nullif(v_price_payload->>'dealerEligibility','') else null end,
    case when v_price.id is not null then nullif(v_price_payload->>'priceStrategy','') else null end,
    case when v_price.id is not null then nullif(v_price_payload->>'turnoverRuleVersion','') else null end,
    case when v_price.id is not null then nullif(v_price_payload->>'turnoverRuleCohort','') else null end,
    case when v_price.id is not null and nullif(v_price_payload->>'priceCalculatedAt','') is not null then (v_price_payload->>'priceCalculatedAt')::timestamptz else null end,
    case when v_price.id is not null then v_price.event_id else null end
  );

  update public.external_entity_links
  set sync_status='LINKED',
      last_synced_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        - 'integrityError' - 'integrityDetectedAt'
        || jsonb_build_object(
          'orphanRecoveredAt',now(),
          'orphanRecoveredTargetId',v_product_id::text,
          'recoverySourceIntakeEventId',v_intake.event_id::text
        ),
      updated_at=now()
  where id=v_link.id;

  update public.integration_event_inbox
  set last_error='RECOVERED_ORPHAN_TARGET:' || coalesce(last_error,'UNKNOWN'),
      updated_at=now()
  where entity_id=v_link.source_entity_id
    and status in ('DEAD','FAILED')
    and coalesce(last_error,'') not like 'RECOVERED_ORPHAN_TARGET:%'
    and coalesce(last_error,'') in (
      'PRICING_MAPPING_CONFLICT',
      'PRICING_MAPPING_NOT_FOUND',
      'BRIDGE_AVAILABILITY_PRODUCT_CONFLICT',
      'BRIDGE_AVAILABILITY_MAPPING_CONFLICT',
      'SALE_MAPPING_CONFLICT'
    );
  get diagnostics v_recovered_failures=row_count;

  return jsonb_build_object(
    'outcome','RECOVERED',
    'productId',v_product_id,
    'sku',v_sku,
    'availability',v_availability,
    'availabilityVersion',v_availability_version,
    'status',v_status,
    'recoveredFailures',v_recovered_failures
  );
end;
$$;

revoke execute on function public.repair_one_orphaned_product(uuid) from public,anon,authenticated;
grant execute on function public.repair_one_orphaned_product(uuid) to service_role;

do $$
declare r record; v jsonb;
begin
  for r in
    select l.id
    from public.external_entity_links l
    where l.source_system='amphon-system'
      and l.source_entity_type='product_intake_unit'
      and l.target_system='product-hub'
      and l.target_entity_type='product'
      and not exists(select 1 from public.products p where p.id::text=l.target_entity_id)
  loop
    v := public.repair_one_orphaned_product(r.id);
    if coalesce(v->>'outcome','') not in ('RECOVERED','ALREADY_PRESENT') then
      raise exception 'ORPHAN_RECOVERY_FAILED:%',v::text;
    end if;
  end loop;
end $$;

create or replace view public.one_integrity_issues_v
with (security_invoker=true)
as
select
  'ONE_MANAGED_STATUS_AVAILABILITY_DRIFT'::text issue_type,
  p.id::text entity_id,
  p.sku,
  jsonb_build_object('status',p.status,'availability',p.one_availability) detail,
  p.updated_at observed_at
from public.products p
where p.one_managed=true
  and (
    (p.status='sold' and p.one_availability is distinct from 'SOLD')
    or (p.status='published' and p.one_availability is distinct from 'IN_STOCK')
  )
union all
select
  'ONE_MANAGED_LINK_MISSING',
  p.id::text,
  p.sku,
  jsonb_build_object('oneManaged',true),
  p.updated_at
from public.products p
where p.one_managed=true
  and not exists (
    select 1 from public.external_entity_links l
    where l.target_system='product-hub'
      and l.target_entity_type='product'
      and l.target_entity_id=p.id::text
      and l.sync_status='LINKED'
  )
union all
select
  'ORPHAN_TARGET_LINK',
  l.id::text,
  l.business_key,
  jsonb_build_object('sourceEntityId',l.source_entity_id,'targetEntityId',l.target_entity_id,'syncStatus',l.sync_status),
  l.updated_at
from public.external_entity_links l
where l.target_system='product-hub'
  and l.target_entity_type='product'
  and not exists (select 1 from public.products p where p.id::text=l.target_entity_id)
union all
select
  'INTEGRATION_INBOX_FAILURE',
  i.id::text,
  i.entity_sku,
  jsonb_build_object('eventType',i.event_type,'status',i.status,'error',i.last_error,'attempts',i.attempts),
  i.updated_at
from public.integration_event_inbox i
where i.status in ('DEAD','FAILED')
  and i.updated_at >= now()-interval '14 days'
  and coalesce(i.last_error,'') not like 'RECOVERED_ORPHAN_TARGET:%';

revoke all on public.one_integrity_issues_v from anon,authenticated;
grant select on public.one_integrity_issues_v to service_role;

select public.capture_business_growth_daily(timezone('Asia/Bangkok',now())::date);

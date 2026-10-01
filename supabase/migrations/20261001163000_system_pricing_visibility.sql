-- Product Hub Pricing Visibility
-- AMPHON System remains pricing authority. Hub stores a read-only projection only.

alter table public.products
  add column if not exists one_retail_price numeric,
  add column if not exists one_quick_sale_price numeric,
  add column if not exists one_dealer_price numeric,
  add column if not exists one_absolute_floor_price numeric,
  add column if not exists one_stock_age_days integer,
  add column if not exists one_aging_bucket text,
  add column if not exists one_dealer_eligibility text,
  add column if not exists one_price_strategy text,
  add column if not exists one_turnover_rule_version text,
  add column if not exists one_turnover_rule_cohort text,
  add column if not exists one_pricing_updated_at timestamptz,
  add column if not exists one_pricing_last_event_id uuid;

create index if not exists products_one_dealer_eligibility_idx
  on public.products(one_dealer_eligibility)
  where one_managed = true;

create index if not exists products_one_stock_age_days_idx
  on public.products(one_stock_age_days)
  where one_managed = true;

create or replace function public.one_pricing_consume_event(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inbox public.integration_event_inbox%rowtype;
  v_payload jsonb;
  v_link public.external_entity_links%rowtype;
  v_product_id uuid;
  v_identity_id text;
  v_sku text;
  v_error text;
begin
  select *
    into v_inbox
  from public.integration_event_inbox
  where event_id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('outcome','NOT_FOUND','error','PRICING_INBOX_EVENT_NOT_FOUND');
  end if;

  if v_inbox.status = 'PROCESSED' then
    return jsonb_build_object('outcome','DUPLICATE','sku',v_inbox.entity_sku);
  end if;

  if v_inbox.status = 'DEAD' then
    return jsonb_build_object('outcome','DEAD','error',coalesce(v_inbox.last_error,'PRICING_EVENT_DEAD'));
  end if;

  v_payload := v_inbox.payload -> 'payload';
  v_identity_id := nullif(btrim(coalesce(v_payload ->> 'productIdentityId','')), '');
  v_sku := upper(nullif(btrim(coalesce(v_payload ->> 'sku','')), ''));

  if v_inbox.source <> 'amphon-system'
     or v_inbox.event_type <> 'product.pricing_changed'
     or v_inbox.entity_type <> 'product_intake_unit'
     or v_identity_id is null
     or v_sku is null
     or v_identity_id <> coalesce(v_inbox.entity_id,'')
     or v_sku <> upper(coalesce(v_inbox.entity_sku,''))
  then
    v_error := 'PRICING_EVENT_INVALID';
    update public.integration_event_inbox
      set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error);
  end if;

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
    v_error := 'PRICING_MAPPING_NOT_FOUND';
    update public.integration_event_inbox
      set status = 'FAILED', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','RETRY','error',v_error,'sku',v_sku);
  end if;

  begin
    v_product_id := v_link.target_entity_id::uuid;
  exception when others then
    v_product_id := null;
  end;

  if v_product_id is null
     or not exists (
       select 1 from public.products
       where id = v_product_id and upper(sku) = v_sku
     )
  then
    v_error := 'PRICING_MAPPING_CONFLICT';
    update public.integration_event_inbox
      set status = 'DEAD', last_error = v_error, updated_at = now()
    where id = v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  update public.products
  set one_retail_price = nullif(v_payload ->> 'retailPrice','')::numeric,
      one_quick_sale_price = nullif(v_payload ->> 'quickSalePrice','')::numeric,
      one_dealer_price = nullif(v_payload ->> 'dealerPrice','')::numeric,
      one_absolute_floor_price = nullif(v_payload ->> 'absoluteFloorPrice','')::numeric,
      one_stock_age_days = coalesce(nullif(v_payload ->> 'stockAgeDays','')::integer, 0),
      one_aging_bucket = nullif(v_payload ->> 'agingBucket',''),
      one_dealer_eligibility = nullif(v_payload ->> 'dealerEligibility',''),
      one_price_strategy = nullif(v_payload ->> 'priceStrategy',''),
      one_turnover_rule_version = nullif(v_payload ->> 'turnoverRuleVersion',''),
      one_turnover_rule_cohort = nullif(v_payload ->> 'turnoverRuleCohort',''),
      one_pricing_updated_at = coalesce(nullif(v_payload ->> 'priceCalculatedAt','')::timestamptz, now()),
      one_pricing_last_event_id = p_event_id,
      updated_at = now()
  where id = v_product_id;

  update public.integration_event_inbox
  set status = 'PROCESSED',
      processed_at = coalesce(processed_at, now()),
      last_error = null,
      updated_at = now()
  where id = v_inbox.id;

  return jsonb_build_object(
    'outcome','APPLIED',
    'hubProductId',v_product_id::text,
    'sku',v_sku,
    'dealerEligibility',v_payload ->> 'dealerEligibility'
  );
exception
  when others then
    raise;
end;
$$;

revoke all on function public.one_pricing_consume_event(uuid) from public;
revoke all on function public.one_pricing_consume_event(uuid) from anon, authenticated;
grant execute on function public.one_pricing_consume_event(uuid) to service_role;

comment on function public.one_pricing_consume_event(uuid) is
  'Server-only consumer for AMPHON System turnover pricing projections.';

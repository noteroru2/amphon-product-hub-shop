-- AI Buyer Owner Model V1
-- Deterministic owner-style / owner-price learning layer.
-- Shadow only: this migration never changes or sends customer offers.

create or replace function public.ai_buyer_parse_owner_price_quote(p_text text)
returns table(
  amount_min numeric,
  amount_max numeric,
  amount numeric,
  confidence numeric,
  pattern text
)
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  t text;
  m text[];
  a numeric;
  b numeric;
  c numeric;
begin
  t := lower(
    translate(
      replace(coalesce(p_text,''), ',', ''),
      '๐๑๒๓๔๕๖๗๘๙',
      '0123456789'
    )
  );
  t := trim(t);

  if t = '' then return; end if;

  if t ~ '(tb|gb|ชิ้น|ตัว)[[:space:]]*ละ[[:space:]]*[0-9]' then return; end if;
  if t ~ '(ราคาจะหาย|หัก|ส่วนลด|ลดราคา)[^0-9]{0,24}[0-9]' then return; end if;

  m := regexp_match(
    t,
    '([0-9]{1,7})[[:space:]]*(บาท)?[[:space:]]*(-|–|—|ถึง)[[:space:]]*([0-9]{1,7})'
  );
  if m is not null and (t ~ 'รับ' or t ~ 'บาท' or t ~ 'ราคา') then
    a := m[1]::numeric;
    b := m[4]::numeric;

    if a < 100 and b >= 1000 and length(m[1]) < length(m[4]) then
      a := a * power(10, length(m[4]) - length(m[1]));
    end if;

    if least(a,b) >= 50 and greatest(a,b) <= 1000000 then
      c := case
        when t ~ 'ราคาที่เสนอรับซื้อ' then 0.99
        when t ~ 'รับ' then 0.95
        else 0.90
      end;
      return query
      select least(a,b), greatest(a,b), least(a,b), c, 'RANGE'::text;
      return;
    end if;
  end if;

  m := regexp_match(t, 'ราคาที่เสนอรับซื้อ[^0-9]{0,40}([0-9]{2,7})');
  if m is not null then
    a := m[1]::numeric;
    if a between 50 and 1000000 then
      return query select a,a,a,0.99::numeric,'EXPLICIT_BUY_QUOTE'::text;
      return;
    end if;
  end if;

  m := regexp_match(t, 'รับ[^0-9]{0,30}([0-9]{2,7})[[:space:]]*บาท');
  if m is not null then
    a := m[1]::numeric;
    if a between 50 and 1000000 then
      return query select a,a,a,0.97::numeric,'BUY_WITH_BAHT'::text;
      return;
    end if;
  end if;

  m := regexp_match(t, '([0-9]{2,7})[[:space:]]*บาท');
  if m is not null then
    a := m[1]::numeric;
    if a between 50 and 1000000 then
      return query select a,a,a,0.91::numeric,'BAHT_AMOUNT'::text;
      return;
    end if;
  end if;

  m := regexp_match(
    t,
    '^[[:space:]]*([0-9]{2,7})[[:space:]]*(ครับ|ค่ะ|คะ)?[[:space:]]*$'
  );
  if m is not null then
    a := m[1]::numeric;
    if a between 50 and 1000000 then
      return query select a,a,a,0.82::numeric,'NUMERIC_ONLY'::text;
      return;
    end if;
  end if;

  return;
end;
$$;

revoke all on function public.ai_buyer_parse_owner_price_quote(text)
from public, anon, authenticated;
grant execute on function public.ai_buyer_parse_owner_price_quote(text)
to service_role;

create or replace function public.ai_buyer_backfill_owner_price_labels()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  with candidates as (
    select
      e.id as learning_event_id,
      e.window_id,
      e.conversation_id,
      e.case_id,
      e.source_external_id,
      e.occurred_at,
      e.text_content,
      p.amount_min,
      p.amount_max,
      p.amount,
      p.confidence,
      p.pattern
    from public.ai_buyer_learning_events e
    cross join lateral public.ai_buyer_parse_owner_price_quote(e.text_content) p
    where e.speaker = 'OWNER_MANUAL'
      and e.direction = 'OUTBOUND'
      and e.message_type = 'TEXT'
      and e.case_id is not null
      and not exists (
        select 1
        from public.ai_buyer_learning_labels l
        where l.window_id = e.window_id
          and l.case_id = e.case_id
          and l.label_type = 'PRICE_QUOTE'
          and (
            l.source_ref = 'OWNER_PRICE_EVENT:' || e.id::text
            or (
              e.source_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and l.source_event_ids @> array[e.source_external_id::uuid]
            )
          )
      )
  ),
  inserted as (
    insert into public.ai_buyer_learning_labels(
      window_id,
      conversation_id,
      case_id,
      label_type,
      payload,
      confidence,
      verified,
      source_event_ids,
      source_ref
    )
    select
      c.window_id,
      c.conversation_id,
      c.case_id,
      'PRICE_QUOTE',
      jsonb_build_object(
        'actor','OWNER_MANUAL',
        'amount',c.amount,
        'amountMin',c.amount_min,
        'amountMax',c.amount_max,
        'isRange',(c.amount_min <> c.amount_max),
        'occurredAt',c.occurred_at,
        'extraction','DETERMINISTIC_OWNER_TEXT_V1',
        'pattern',c.pattern,
        'learningEventId',c.learning_event_id,
        'sourceExternalId',c.source_external_id
      ),
      c.confidence,
      false,
      array[c.learning_event_id],
      'OWNER_PRICE_EVENT:' || c.learning_event_id::text
    from candidates c
    on conflict do nothing
    returning 1
  )
  select count(*)::int into v_inserted from inserted;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.ai_buyer_backfill_owner_price_labels()
from public, anon, authenticated;
grant execute on function public.ai_buyer_backfill_owner_price_labels()
to service_role;

create or replace view public.ai_buyer_owner_conversation_pairs_v
with (security_invoker=true) as
select
  o.window_id,
  o.id as owner_event_id,
  o.conversation_id,
  o.case_id,
  c.category,
  c.title,
  c.state,
  prior.id as customer_event_id,
  prior.text_content as customer_message,
  o.text_content as owner_reply,
  extract(epoch from (o.occurred_at-prior.occurred_at))::int as response_gap_seconds,
  price.amount_min as owner_price_min,
  price.amount_max as owner_price_max,
  price.amount as owner_price_amount,
  price.confidence as price_parse_confidence,
  price.pattern as price_parse_pattern,
  o.occurred_at as owner_replied_at
from public.ai_buyer_learning_events o
left join public.ai_buyer_valuation_cases c on c.id=o.case_id
left join lateral (
  select e.id,e.text_content,e.occurred_at
  from public.ai_buyer_learning_events e
  where e.window_id=o.window_id
    and e.conversation_id=o.conversation_id
    and e.speaker='CUSTOMER'
    and e.occurred_at <= o.occurred_at
  order by e.occurred_at desc
  limit 1
) prior on true
left join lateral public.ai_buyer_parse_owner_price_quote(o.text_content) price on true
where o.speaker='OWNER_MANUAL'
  and o.direction='OUTBOUND'
  and o.message_type='TEXT';

revoke all on public.ai_buyer_owner_conversation_pairs_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_conversation_pairs_v to service_role;

create or replace view public.ai_buyer_owner_price_dataset_v
with (security_invoker=true) as
with latest_observation as (
  select distinct on (case_id)
    case_id,
    category,
    model_name,
    model_code,
    confirmed,
    inferred,
    unknown_fields,
    identity_confidence,
    created_at
  from public.ai_buyer_product_observations
  order by case_id, created_at desc
),
latest_pricing as (
  select distinct on (case_id)
    case_id,
    id as pricing_decision_id,
    price_source,
    estimated_resale,
    opening_offer,
    target_buy,
    hard_max,
    current_authorized_offer,
    pricing_confidence,
    adjustments,
    rationale,
    created_at
  from public.ai_buyer_pricing_decisions
  order by case_id, created_at desc
)
select
  l.id as label_id,
  l.window_id,
  l.conversation_id,
  l.case_id,
  c.category,
  c.title,
  c.state,
  c.control_mode,
  o.model_name,
  o.model_code,
  o.confirmed,
  o.inferred,
  o.unknown_fields,
  o.identity_confidence,
  coalesce(nullif(l.payload->>'amountMin','')::numeric, nullif(l.payload->>'amount','')::numeric) as owner_amount_min,
  coalesce(nullif(l.payload->>'amountMax','')::numeric, nullif(l.payload->>'amount','')::numeric) as owner_amount_max,
  nullif(l.payload->>'amount','')::numeric as owner_amount,
  l.confidence as owner_label_confidence,
  l.verified as owner_label_verified,
  l.payload->>'pattern' as extraction_pattern,
  l.payload->>'extraction' as extraction_method,
  p.pricing_decision_id,
  p.price_source,
  p.estimated_resale,
  p.opening_offer as engine_opening_offer,
  p.target_buy as engine_target_buy,
  p.hard_max as engine_hard_max,
  p.pricing_confidence as engine_pricing_confidence,
  case
    when p.opening_offer > 0 and nullif(l.payload->>'amount','') is not null
      then round(((nullif(l.payload->>'amount','')::numeric - p.opening_offer) / p.opening_offer) * 100, 2)
    else null
  end as owner_vs_engine_opening_pct,
  case
    when p.target_buy > 0 and nullif(l.payload->>'amount','') is not null
      then round(((nullif(l.payload->>'amount','')::numeric - p.target_buy) / p.target_buy) * 100, 2)
    else null
  end as owner_vs_engine_target_pct,
  l.created_at as owner_quote_at
from public.ai_buyer_learning_labels l
join public.ai_buyer_valuation_cases c on c.id=l.case_id
left join latest_observation o on o.case_id=l.case_id
left join latest_pricing p on p.case_id=l.case_id
where l.label_type='PRICE_QUOTE'
  and nullif(l.payload->>'amount','') is not null;

revoke all on public.ai_buyer_owner_price_dataset_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_price_dataset_v to service_role;

create or replace view public.ai_buyer_owner_case_price_v
with (security_invoker=true) as
select
  d.case_id,
  (array_agg(d.conversation_id order by d.owner_quote_at asc))[1] as conversation_id,
  max(d.category) as category,
  max(d.title) as title,
  max(d.model_name) as model_name,
  max(d.model_code) as model_code,
  (array_agg(d.owner_amount order by d.owner_quote_at asc))[1] as first_owner_offer,
  (array_agg(d.owner_amount order by d.owner_quote_at desc))[1] as last_owner_offer,
  min(d.owner_amount_min) as owner_floor,
  max(d.owner_amount_max) as owner_ceiling,
  count(*)::int as owner_quote_count,
  bool_or(d.owner_label_verified) as has_verified_owner_quote,
  max(d.owner_label_confidence) as best_owner_label_confidence,
  max(d.engine_opening_offer) as engine_opening_offer,
  max(d.engine_target_buy) as engine_target_buy,
  max(d.engine_hard_max) as engine_hard_max,
  max(d.estimated_resale) as estimated_resale,
  max(d.engine_pricing_confidence) as engine_pricing_confidence,
  min(d.owner_quote_at) as first_owner_quote_at,
  max(d.owner_quote_at) as last_owner_quote_at
from public.ai_buyer_owner_price_dataset_v d
group by d.case_id;

revoke all on public.ai_buyer_owner_case_price_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_case_price_v to service_role;

create or replace view public.ai_buyer_owner_pricebook_candidates_v
with (security_invoker=true) as
select
  p.case_id,
  p.category,
  p.title,
  p.model_name,
  p.model_code,
  p.first_owner_offer as suggested_opening_offer,
  greatest(p.first_owner_offer, p.last_owner_offer) as suggested_target_buy,
  greatest(p.owner_ceiling, p.last_owner_offer) as suggested_hard_max,
  p.owner_floor,
  p.owner_ceiling,
  p.owner_quote_count,
  p.has_verified_owner_quote,
  p.best_owner_label_confidence,
  case
    when p.model_code is not null and p.has_verified_owner_quote then 'HIGH'
    when p.model_code is not null or p.model_name is not null then 'MEDIUM'
    else 'LOW'
  end as candidate_confidence,
  case
    when p.model_code is not null then true
    when p.model_name is not null and p.owner_quote_count >= 2 then true
    else false
  end as ready_for_pricebook_review,
  p.first_owner_quote_at,
  p.last_owner_quote_at
from public.ai_buyer_owner_case_price_v p;

revoke all on public.ai_buyer_owner_pricebook_candidates_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_pricebook_candidates_v to service_role;

create or replace view public.ai_buyer_owner_calibration_v
with (security_invoker=true) as
select
  category,
  count(*)::int as paired_cases,
  round(
    percentile_cont(0.5) within group (
      order by (last_owner_offer / nullif(engine_target_buy,0))::double precision
    )::numeric,
    4
  ) as median_owner_to_engine_target_ratio,
  round(
    percentile_cont(0.5) within group (
      order by ((last_owner_offer-engine_target_buy) / nullif(engine_target_buy,0) * 100)::double precision
    )::numeric,
    2
  ) as median_owner_vs_engine_target_pct,
  round(
    avg(((last_owner_offer-engine_target_buy) / nullif(engine_target_buy,0) * 100))::numeric,
    2
  ) as avg_owner_vs_engine_target_pct,
  count(*) >= 5 as ready_for_shadow,
  count(*) >= 20 as ready_for_runtime_review
from public.ai_buyer_owner_case_price_v
where engine_target_buy is not null
  and engine_target_buy > 0
  and last_owner_offer is not null
group by category;

revoke all on public.ai_buyer_owner_calibration_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_calibration_v to service_role;

create or replace view public.ai_buyer_owner_shadow_price_v
with (security_invoker=true) as
select
  p.case_id,
  p.category,
  p.engine_opening_offer,
  p.engine_target_buy,
  p.engine_hard_max,
  c.paired_cases,
  c.median_owner_to_engine_target_ratio as owner_factor,
  c.ready_for_shadow,
  c.ready_for_runtime_review,
  case when c.ready_for_shadow then
    least(
      p.engine_hard_max,
      greatest(0, round((p.engine_opening_offer * c.median_owner_to_engine_target_ratio) / 100) * 100)
    )
  end as shadow_opening_offer,
  case when c.ready_for_shadow then
    least(
      p.engine_hard_max,
      greatest(0, round((p.engine_target_buy * c.median_owner_to_engine_target_ratio) / 100) * 100)
    )
  end as shadow_target_buy,
  case when c.ready_for_shadow then
    least(
      p.engine_hard_max,
      greatest(0, round((p.engine_hard_max * c.median_owner_to_engine_target_ratio) / 100) * 100)
    )
  end as shadow_hard_max
from public.ai_buyer_owner_case_price_v p
left join public.ai_buyer_owner_calibration_v c using (category)
where p.engine_target_buy is not null;

revoke all on public.ai_buyer_owner_shadow_price_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_shadow_price_v to service_role;

create or replace view public.ai_buyer_owner_model_status_v
with (security_invoker=true) as
select
  (select count(*)::int from public.ai_buyer_owner_conversation_pairs_v) as conversation_pairs,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v) as price_labels,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v where owner_label_verified) as verified_price_labels,
  (select count(distinct case_id)::int from public.ai_buyer_owner_price_dataset_v) as priced_cases,
  (select count(*)::int from public.ai_buyer_owner_pricebook_candidates_v where ready_for_pricebook_review) as pricebook_candidates,
  (select count(*)::int from public.ai_buyer_owner_case_price_v where engine_target_buy is not null) as engine_owner_pairs,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_shadow) as shadow_ready_categories,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_runtime_review) as runtime_review_ready_categories,
  now() as generated_at;

revoke all on public.ai_buyer_owner_model_status_v
from public, anon, authenticated;
grant select on public.ai_buyer_owner_model_status_v to service_role;

select public.ai_buyer_backfill_owner_price_labels();


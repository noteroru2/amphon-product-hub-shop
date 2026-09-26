create table if not exists public.ai_buyer_owner_identity_enrichment (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.ai_buyer_valuation_cases(id) on delete cascade,
  category text,
  brand text,
  model_name text,
  model_code text,
  specs jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  evidence_event_ids uuid[] not null default '{}'::uuid[],
  source text not null default 'OPENAI_TEXT_CONTEXT_V1'
    check (source in ('OPENAI_TEXT_CONTEXT_V1','MANUAL_OWNER','SYSTEM_OBSERVATION')),
  review_status text not null default 'CANDIDATE'
    check (review_status in ('CANDIDATE','APPROVED','REJECTED')),
  provider_model text,
  rationale jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_buyer_owner_identity_enrichment enable row level security;
revoke all on public.ai_buyer_owner_identity_enrichment from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_owner_identity_enrichment to service_role;

create or replace view public.ai_buyer_owner_price_dataset_v
with (security_invoker=true) as
with latest_observation as (
  select distinct on (case_id)
    case_id,category,model_name,model_code,confirmed,inferred,unknown_fields,
    identity_confidence,created_at
  from public.ai_buyer_product_observations
  order by case_id,created_at desc
),
latest_pricing as (
  select distinct on (case_id)
    case_id,id as pricing_decision_id,price_source,estimated_resale,opening_offer,
    target_buy,hard_max,current_authorized_offer,pricing_confidence,adjustments,
    rationale,created_at
  from public.ai_buyer_pricing_decisions
  order by case_id,created_at desc
)
select
  l.id as label_id,
  l.window_id,
  l.conversation_id,
  l.case_id,
  coalesce(c.category,ie.category,o.category) as category,
  c.title,
  c.state,
  c.control_mode,
  coalesce(o.model_name,ie.model_name) as model_name,
  coalesce(o.model_code,ie.model_code) as model_code,
  coalesce(o.confirmed,'{}'::jsonb) || coalesce(ie.specs,'{}'::jsonb) as confirmed,
  o.inferred,
  o.unknown_fields,
  greatest(coalesce(o.identity_confidence,0::numeric),coalesce(ie.confidence,0::numeric))::numeric(5,4) as identity_confidence,
  coalesce(nullif(l.payload->>'amountMin','')::numeric,nullif(l.payload->>'amount','')::numeric) as owner_amount_min,
  coalesce(nullif(l.payload->>'amountMax','')::numeric,nullif(l.payload->>'amount','')::numeric) as owner_amount_max,
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
    then round(((nullif(l.payload->>'amount','')::numeric-p.opening_offer)/p.opening_offer)*100,2)
  end as owner_vs_engine_opening_pct,
  case
    when p.target_buy > 0 and nullif(l.payload->>'amount','') is not null
    then round(((nullif(l.payload->>'amount','')::numeric-p.target_buy)/p.target_buy)*100,2)
  end as owner_vs_engine_target_pct,
  coalesce(
    nullif(l.payload->>'occurredAt','')::timestamptz,
    nullif(l.payload->>'sentAt','')::timestamptz,
    l.created_at
  ) as owner_quote_at,
  (l.verified or coalesce(l.confidence,0) >= 0.90) as high_confidence_owner_quote,
  ie.brand as enriched_brand,
  ie.review_status as identity_review_status
from public.ai_buyer_learning_labels l
join public.ai_buyer_valuation_cases c on c.id=l.case_id
left join latest_observation o on o.case_id=l.case_id
left join public.ai_buyer_owner_identity_enrichment ie on ie.case_id=l.case_id
left join latest_pricing p on p.case_id=l.case_id
where l.label_type='PRICE_QUOTE'
  and nullif(l.payload->>'amount','') is not null;
revoke all on public.ai_buyer_owner_price_dataset_v from public,anon,authenticated;
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
  max(d.owner_quote_at) as last_owner_quote_at,
  (array_agg(d.owner_amount order by d.owner_quote_at asc)
    filter (where d.high_confidence_owner_quote))[1] as first_high_conf_owner_offer,
  (array_agg(d.owner_amount order by d.owner_quote_at desc)
    filter (where d.high_confidence_owner_quote))[1] as last_high_conf_owner_offer,
  min(d.owner_amount_min) filter (where d.high_confidence_owner_quote) as high_conf_owner_floor,
  max(d.owner_amount_max) filter (where d.high_confidence_owner_quote) as high_conf_owner_ceiling,
  count(*) filter (where d.high_confidence_owner_quote)::int as high_conf_owner_quote_count,
  max(d.enriched_brand) as enriched_brand
from public.ai_buyer_owner_price_dataset_v d
group by d.case_id;
revoke all on public.ai_buyer_owner_case_price_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_case_price_v to service_role;

create or replace view public.ai_buyer_owner_price_context_v
with (security_invoker=true) as
select
  d.label_id,d.case_id,d.conversation_id,d.category,d.title,d.model_name,d.model_code,
  d.owner_amount_min,d.owner_amount_max,d.owner_amount,d.owner_label_confidence,
  d.owner_label_verified,d.owner_quote_at,d.high_confidence_owner_quote,
  ctx.context_text,ctx.customer_text_count,ctx.owner_text_count,ctx.image_event_count,
  ctx.evidence_event_ids
from public.ai_buyer_owner_price_dataset_v d
left join lateral (
  select
    string_agg(
      '[' || x.speaker || '] ' || left(coalesce(x.text_content,''),1000),
      E'\n' order by x.occurred_at
    ) filter (where x.message_type='TEXT') as context_text,
    count(*) filter (where x.speaker='CUSTOMER' and x.message_type='TEXT')::int as customer_text_count,
    count(*) filter (where x.speaker='OWNER_MANUAL' and x.message_type='TEXT')::int as owner_text_count,
    count(*) filter (where x.message_type='IMAGE')::int as image_event_count,
    array_agg(x.id order by x.occurred_at) as evidence_event_ids
  from (
    select e.*
    from public.ai_buyer_learning_events e
    where e.window_id=d.window_id
      and (e.case_id=d.case_id or e.conversation_id=d.conversation_id)
      and e.occurred_at <= d.owner_quote_at
      and e.occurred_at >= d.owner_quote_at - interval '7 days'
    order by e.occurred_at desc
    limit 30
  ) x
) ctx on true;
revoke all on public.ai_buyer_owner_price_context_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_price_context_v to service_role;

create or replace view public.ai_buyer_owner_pricebook_candidates_v
with (security_invoker=true) as
select
  p.case_id,p.category,p.title,p.model_name,p.model_code,
  p.first_high_conf_owner_offer as suggested_opening_offer,
  greatest(p.first_high_conf_owner_offer,p.last_high_conf_owner_offer) as suggested_target_buy,
  greatest(p.high_conf_owner_ceiling,p.last_high_conf_owner_offer) as suggested_hard_max,
  p.high_conf_owner_floor as owner_floor,
  p.high_conf_owner_ceiling as owner_ceiling,
  p.high_conf_owner_quote_count as owner_quote_count,
  p.has_verified_owner_quote,
  p.best_owner_label_confidence,
  case
    when p.model_code is not null and p.has_verified_owner_quote then 'HIGH'
    when p.model_code is not null and p.best_owner_label_confidence >= 0.90 then 'MEDIUM'
    when p.model_name is not null and p.best_owner_label_confidence >= 0.90 then 'MEDIUM'
    else 'LOW'
  end as candidate_confidence,
  case
    when p.high_conf_owner_quote_count = 0 then false
    when p.model_code is not null and p.best_owner_label_confidence >= 0.90 then true
    when p.model_name is not null and p.high_conf_owner_quote_count >= 2 then true
    else false
  end as ready_for_pricebook_review,
  p.first_owner_quote_at,
  p.last_owner_quote_at,
  p.enriched_brand as brand
from public.ai_buyer_owner_case_price_v p
where p.first_high_conf_owner_offer is not null;
revoke all on public.ai_buyer_owner_pricebook_candidates_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_pricebook_candidates_v to service_role;

create or replace view public.ai_buyer_owner_calibration_v
with (security_invoker=true) as
select
  category,
  count(*)::int as paired_cases,
  round(percentile_cont(0.5) within group (
    order by (last_high_conf_owner_offer/nullif(engine_target_buy,0))::double precision
  )::numeric,4) as median_owner_to_engine_target_ratio,
  round(percentile_cont(0.5) within group (
    order by ((last_high_conf_owner_offer-engine_target_buy)/nullif(engine_target_buy,0)*100)::double precision
  )::numeric,2) as median_owner_vs_engine_target_pct,
  round(avg(((last_high_conf_owner_offer-engine_target_buy)/nullif(engine_target_buy,0)*100))::numeric,2)
    as avg_owner_vs_engine_target_pct,
  count(*) >= 5 as ready_for_shadow,
  count(*) >= 20 as ready_for_runtime_review
from public.ai_buyer_owner_case_price_v
where engine_target_buy is not null
  and engine_target_buy > 0
  and last_high_conf_owner_offer is not null
  and category is not null
group by category;
revoke all on public.ai_buyer_owner_calibration_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_calibration_v to service_role;

create or replace view public.ai_buyer_owner_shadow_price_v
with (security_invoker=true) as
select
  p.case_id,p.category,p.engine_opening_offer,p.engine_target_buy,p.engine_hard_max,
  c.paired_cases,c.median_owner_to_engine_target_ratio as owner_factor,
  c.ready_for_shadow,c.ready_for_runtime_review,
  case when c.ready_for_shadow then least(
    p.engine_hard_max,
    greatest(0,round((p.engine_opening_offer*c.median_owner_to_engine_target_ratio)/100)*100)
  ) end as shadow_opening_offer,
  case when c.ready_for_shadow then least(
    p.engine_hard_max,
    greatest(0,round((p.engine_target_buy*c.median_owner_to_engine_target_ratio)/100)*100)
  ) end as shadow_target_buy,
  case when c.ready_for_shadow then least(
    p.engine_hard_max,
    greatest(0,round((p.engine_hard_max*c.median_owner_to_engine_target_ratio)/100)*100)
  ) end as shadow_hard_max
from public.ai_buyer_owner_case_price_v p
left join public.ai_buyer_owner_calibration_v c using(category)
where p.engine_target_buy is not null;
revoke all on public.ai_buyer_owner_shadow_price_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_shadow_price_v to service_role;

create or replace view public.ai_buyer_owner_model_status_v
with (security_invoker=true) as
select
  (select count(*)::int from public.ai_buyer_owner_conversation_pairs_v) as conversation_pairs,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v) as price_labels,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v where owner_label_verified) as verified_price_labels,
  (select count(distinct case_id)::int from public.ai_buyer_owner_price_dataset_v) as priced_cases,
  (select count(*)::int from public.ai_buyer_owner_pricebook_candidates_v where ready_for_pricebook_review) as pricebook_candidates,
  (select count(*)::int from public.ai_buyer_owner_case_price_v where engine_target_buy is not null and last_high_conf_owner_offer is not null) as engine_owner_pairs,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_shadow) as shadow_ready_categories,
  (select count(*)::int from public.ai_buyer_owner_calibration_v where ready_for_runtime_review) as runtime_review_ready_categories,
  now() as generated_at,
  (select count(*)::int from public.ai_buyer_owner_price_dataset_v where high_confidence_owner_quote) as high_conf_price_labels,
  (select count(*)::int from public.ai_buyer_owner_price_context_v where coalesce(context_text,'') <> '') as priced_contexts,
  (select count(*)::int from public.ai_buyer_owner_identity_enrichment where review_status <> 'REJECTED') as identity_enrichments;
revoke all on public.ai_buyer_owner_model_status_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_model_status_v to service_role;


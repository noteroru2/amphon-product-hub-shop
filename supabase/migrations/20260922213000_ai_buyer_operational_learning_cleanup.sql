-- P0 operational cleanup: exclude technical/non-valuation cancellations from
-- final-deal labeling, mark training eligibility, and expose Day-5 readiness.

create or replace view public.ai_buyer_learning_deal_dataset_v
with (security_invoker=false) as
with latest_observation as (
  select distinct on (case_id)
    case_id,category,model_name,model_code,confirmed,inferred,unknown_fields,
    identity_confidence,created_at
  from public.ai_buyer_product_observations
  order by case_id,created_at desc
),
latest_pricing as (
  select distinct on (case_id)
    case_id,price_source,estimated_resale,opening_offer,target_buy,hard_max,
    current_authorized_offer,pricing_confidence,adjustments,rationale,created_at
  from public.ai_buyer_pricing_decisions
  order by case_id,created_at desc
),
owner_quotes as (
  select
    case_id,
    count(*) filter (where label_type='PRICE_QUOTE')::int as owner_quote_count,
    min((payload->>'amount')::numeric) filter (
      where label_type='PRICE_QUOTE' and payload ? 'amount'
    ) as owner_quote_min,
    max((payload->>'amount')::numeric) filter (
      where label_type='PRICE_QUOTE' and payload ? 'amount'
    ) as owner_quote_max,
    jsonb_agg(payload order by created_at) filter (where label_type='PRICE_QUOTE') as owner_quotes
  from public.ai_buyer_learning_labels
  group by case_id
)
select
  c.id as case_id,
  c.conversation_id,
  c.customer_id,
  c.category,
  c.title,
  c.state,
  c.control_mode,
  c.identity_confidence,
  c.spec_completeness,
  c.condition_completeness,
  c.pricing_readiness,
  c.metadata->'lastPricingTags' as pricing_tags,
  o.model_name,
  o.model_code,
  o.confirmed,
  o.inferred,
  o.unknown_fields,
  p.price_source,
  p.estimated_resale,
  p.opening_offer as engine_opening_offer,
  p.target_buy as engine_target_buy,
  p.hard_max as engine_hard_max,
  p.current_authorized_offer,
  p.pricing_confidence,
  p.adjustments as pricing_adjustments,
  coalesce(q.owner_quote_count,0) as owner_quote_count,
  q.owner_quote_min,
  q.owner_quote_max,
  q.owner_quotes,
  outcome.final_label,
  outcome.final_agreed_price,
  coalesce(outcome.purchase_price,deal.outcome_purchase_price) as verified_purchase_price,
  outcome.reason_code as outcome_reason_code,
  outcome.outcome_at,
  outcome.verified as outcome_verified,
  deal.ledger_lines,
  deal.purchase_total,
  deal.repair_total,
  deal.parts_total,
  deal.transport_total,
  deal.warranty_total,
  deal.channel_fee_total,
  deal.other_cost_total,
  deal.total_cost,
  deal.sale_total,
  deal.gross_profit,
  deal.first_acquired_at,
  deal.last_sold_at,
  deal.sold_lines,
  deal.in_stock_lines,
  case
    when deal.first_acquired_at is null then null
    when deal.last_sold_at is not null
      then greatest(0,extract(day from deal.last_sold_at-deal.first_acquired_at)::int)
    else greatest(0,extract(day from now()-deal.first_acquired_at)::int)
  end as inventory_days,
  case
    when deal.sale_total is null or deal.sale_total=0 or deal.gross_profit is null then null
    else round((deal.gross_profit/deal.sale_total)*100,2)
  end as gross_margin_percent,
  case
    when deal.total_cost is null or deal.total_cost=0 or deal.gross_profit is null then null
    else round((deal.gross_profit/deal.total_cost)*100,2)
  end as roi_percent,
  c.created_at as case_created_at,
  c.updated_at as case_updated_at,
  (
    coalesce(c.metadata->>'cancelReason','') not in (
      'CONCURRENT_DUPLICATE_CASE',
      'NON_SELLER_PAWN_OR_DEPOSIT_INQUIRY',
      'NON_SELLER_PAWN_INQUIRY',
      'NON_SELLER_BUYING_INQUIRY',
      'LOGISTICS_ONLY_NO_ACTIVE_PRODUCT',
      'STICKER_ONLY_NO_PRODUCT'
    )
  ) as training_eligible,
  nullif(c.metadata->>'cancelReason','') as training_exclusion_reason
from public.ai_buyer_valuation_cases c
left join latest_observation o on o.case_id=c.id
left join latest_pricing p on p.case_id=c.id
left join owner_quotes q on q.case_id=c.id
left join public.ai_buyer_case_outcomes outcome on outcome.case_id=c.id
left join public.ai_buyer_deal_ledger_case_v deal on deal.case_id=c.id;

create or replace view public.ai_buyer_final_label_queue_v
with (security_invoker=false) as
select
  c.id as case_id,
  c.title,
  c.category,
  c.state,
  c.accepted_price,
  c.accepted_at,
  c.created_at,
  c.updated_at,
  (
    select m.text_content
    from public.ai_buyer_messages m
    where m.case_id=c.id
      and m.direction='INBOUND'
      and m.message_type='TEXT'
    order by m.created_at desc
    limit 1
  ) as last_customer_text,
  (
    select m.text_content
    from public.ai_buyer_messages m
    where m.case_id=c.id
      and m.direction='OUTBOUND'
      and m.message_type='TEXT'
    order by m.created_at desc
    limit 1
  ) as last_shop_text,
  (
    select off.amount
    from public.ai_buyer_offers off
    where off.case_id=c.id
      and off.actor in ('AI','ADMIN')
    order by off.created_at desc
    limit 1
  ) as last_shop_offer
from public.ai_buyer_valuation_cases c
left join public.ai_buyer_case_outcomes o on o.case_id=c.id
where o.case_id is null
  and c.state in (
    'ACCEPTED','COLLECTING_FULFILLMENT','ACTION_REQUIRED','ADMIN_ASSIGNED',
    'COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED'
  )
  and coalesce(c.metadata->>'cancelReason','') not in (
    'CONCURRENT_DUPLICATE_CASE',
    'NON_SELLER_PAWN_OR_DEPOSIT_INQUIRY',
    'NON_SELLER_PAWN_INQUIRY',
    'NON_SELLER_BUYING_INQUIRY',
    'LOGISTICS_ONLY_NO_ACTIVE_PRODUCT',
    'STICKER_ONLY_NO_PRODUCT'
  )
order by c.updated_at desc;

create or replace view public.ai_buyer_learning_capture_status_v
with (security_invoker=false) as
with target as (
  select *
  from public.ai_buyer_learning_windows
  order by
    case when status='CAPTURING' then 0 else 1 end,
    created_at desc
  limit 1
),
event_stats as (
  select
    e.window_id,
    count(*)::int as total_events,
    count(*) filter (where e.speaker='CUSTOMER')::int as customer_events,
    count(*) filter (where e.speaker='OWNER_MANUAL')::int as owner_manual_events,
    count(*) filter (where e.speaker='OWNER_APPROVED')::int as owner_approved_events,
    count(*) filter (where e.speaker='AI_SYSTEM')::int as ai_system_events,
    count(distinct e.conversation_id)::int as conversations
  from public.ai_buyer_learning_events e
  join target t on t.id=e.window_id
  group by e.window_id
),
label_stats as (
  select
    l.window_id,
    count(*) filter (where l.label_type='PRICE_QUOTE')::int as price_quote_labels,
    count(*) filter (where l.label_type='CUSTOMER_ACCEPTED')::int as accepted_labels,
    count(*) filter (where l.label_type='CUSTOMER_DECLINED')::int as declined_labels
  from public.ai_buyer_learning_labels l
  join target t on t.id=l.window_id
  group by l.window_id
),
deal_stats as (
  select
    count(*) filter (where d.training_eligible)::int as eligible_cases,
    count(*) filter (where d.training_eligible and d.final_label is not null)::int as final_labeled_cases,
    count(*) filter (where d.training_eligible and d.verified_purchase_price is not null)::int as purchased_cases,
    count(*) filter (where d.training_eligible and d.sale_total is not null)::int as sold_cases,
    coalesce(sum(d.gross_profit) filter (
      where d.training_eligible and d.gross_profit is not null
    ),0)::numeric as realized_gross_profit
  from public.ai_buyer_learning_deal_dataset_v d
),
queue_stats as (
  select count(*)::int as needs_final_label
  from public.ai_buyer_final_label_queue_v
)
select
  t.id as window_id,
  t.name,
  t.status,
  t.starts_at,
  t.ends_at,
  greatest(0,extract(epoch from (t.ends_at-now()))/3600)::numeric(12,2) as hours_remaining,
  coalesce(e.total_events,0) as total_events,
  coalesce(e.customer_events,0) as customer_events,
  coalesce(e.owner_manual_events,0) as owner_manual_events,
  coalesce(e.owner_approved_events,0) as owner_approved_events,
  coalesce(e.ai_system_events,0) as ai_system_events,
  coalesce(e.conversations,0) as conversations,
  coalesce(l.price_quote_labels,0) as price_quote_labels,
  coalesce(l.accepted_labels,0) as accepted_labels,
  coalesce(l.declined_labels,0) as declined_labels,
  coalesce(ds.eligible_cases,0) as eligible_cases,
  coalesce(ds.final_labeled_cases,0) as final_labeled_cases,
  coalesce(ds.purchased_cases,0) as purchased_cases,
  coalesce(ds.sold_cases,0) as sold_cases,
  coalesce(ds.realized_gross_profit,0) as realized_gross_profit,
  coalesce(q.needs_final_label,0) as needs_final_label
from target t
left join event_stats e on e.window_id=t.id
left join label_stats l on l.window_id=t.id
cross join deal_stats ds
cross join queue_stats q;

revoke all on public.ai_buyer_learning_deal_dataset_v from public,anon,authenticated;
revoke all on public.ai_buyer_final_label_queue_v from public,anon,authenticated;
revoke all on public.ai_buyer_learning_capture_status_v from public,anon,authenticated;
grant select on public.ai_buyer_learning_deal_dataset_v to service_role;
grant select on public.ai_buyer_final_label_queue_v to service_role;
grant select on public.ai_buyer_learning_capture_status_v to service_role;

-- P0 operational cleanup: exclude technical/non-valuation cancellations from
-- final-deal labeling and expose Day-5 capture readiness.

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
    coalesce(sum(d.gross_profit) filter (where d.training_eligible and d.gross_profit is not null),0)::numeric as realized_gross_profit
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

revoke all on public.ai_buyer_final_label_queue_v from public,anon,authenticated;
revoke all on public.ai_buyer_learning_capture_status_v from public,anon,authenticated;
grant select on public.ai_buyer_final_label_queue_v to service_role;
grant select on public.ai_buyer_learning_capture_status_v to service_role;

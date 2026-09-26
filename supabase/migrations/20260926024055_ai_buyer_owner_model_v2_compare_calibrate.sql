-- Owner Model V2: compare/calibrate, review workflow, economics and promotion gates.
-- All new learning artifacts are service-role only and do not change live pricing.

create table if not exists public.ai_buyer_owner_shadow_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  pricing_decision_id uuid references public.ai_buyer_pricing_decisions(id) on delete set null,
  capture_key text not null unique,
  trigger_type text not null default 'OWNER_REPLY_PREPARE',
  category text,
  case_state text,
  price_source text,
  estimated_resale numeric,
  opening_offer numeric,
  target_buy numeric,
  hard_max numeric,
  pricing_confidence numeric,
  model_name text,
  model_code text,
  captured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists ai_buyer_owner_shadow_case_time_idx
  on public.ai_buyer_owner_shadow_snapshots(case_id,captured_at desc);

alter table public.ai_buyer_owner_shadow_snapshots enable row level security;
revoke all on public.ai_buyer_owner_shadow_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_owner_shadow_snapshots to service_role;

create or replace function public.ai_buyer_capture_owner_shadow_on_manual_reply()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  d record;
  o record;
  c record;
begin
  if new.action_type <> 'MANUAL_REPLY' then return new; end if;
  if nullif(new.payload->>'offerAmount','') is null then return new; end if;

  select id,conversation_id,category,state into c
  from public.ai_buyer_valuation_cases where id=new.case_id;

  select id,price_source,estimated_resale,opening_offer,target_buy,hard_max,pricing_confidence
  into d
  from public.ai_buyer_pricing_decisions
  where case_id=new.case_id
  order by created_at desc
  limit 1;

  select model_name,model_code,category
  into o
  from public.ai_buyer_product_observations
  where case_id=new.case_id
  order by created_at desc
  limit 1;

  insert into public.ai_buyer_owner_shadow_snapshots(
    case_id,conversation_id,pricing_decision_id,capture_key,trigger_type,
    category,case_state,price_source,estimated_resale,opening_offer,target_buy,
    hard_max,pricing_confidence,model_name,model_code,metadata
  ) values (
    new.case_id,
    coalesce(new.conversation_id,c.conversation_id),
    d.id,
    'MANUAL_REPLY_PRICE:'||new.id::text,
    'OWNER_REPLY_PREPARE',
    coalesce(c.category,o.category),
    c.state,
    d.price_source,
    d.estimated_resale,
    d.opening_offer,
    d.target_buy,
    d.hard_max,
    d.pricing_confidence,
    o.model_name,
    o.model_code,
    jsonb_build_object(
      'outboundActionId',new.id,
      'ownerOfferAmount',nullif(new.payload->>'offerAmount','')::numeric,
      'capturedBeforeDelivery',true
    )
  )
  on conflict (capture_key) do nothing;

  return new;
end;
$$;

revoke all on function public.ai_buyer_capture_owner_shadow_on_manual_reply()
from public,anon,authenticated;
grant execute on function public.ai_buyer_capture_owner_shadow_on_manual_reply()
to service_role;

drop trigger if exists trg_ai_buyer_owner_shadow_manual_reply on public.ai_buyer_outbound_actions;
create trigger trg_ai_buyer_owner_shadow_manual_reply
after insert on public.ai_buyer_outbound_actions
for each row execute function public.ai_buyer_capture_owner_shadow_on_manual_reply();

create table if not exists public.ai_buyer_owner_conversation_shadows (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  analysis_run_id uuid references public.ai_buyer_analysis_runs(id) on delete set null,
  source_message_id uuid references public.ai_buyer_messages(id) on delete set null,
  dedupe_key text not null unique,
  action text not null,
  draft_text text not null,
  category text,
  case_state text,
  model_name text,
  model_code text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists ai_buyer_owner_conversation_shadow_case_idx
  on public.ai_buyer_owner_conversation_shadows(case_id,created_at desc);

alter table public.ai_buyer_owner_conversation_shadows enable row level security;
revoke all on public.ai_buyer_owner_conversation_shadows from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_owner_conversation_shadows to service_role;

create table if not exists public.ai_buyer_owner_pricebook_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.ai_buyer_valuation_cases(id) on delete cascade,
  category text,
  brand text,
  model_name text,
  model_code text,
  candidate_opening_offer numeric not null,
  candidate_target_buy numeric not null,
  candidate_hard_max numeric not null,
  final_opening_offer numeric not null,
  final_target_buy numeric not null,
  final_hard_max numeric not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REJECTED')),
  candidate_confidence text,
  identity_confidence numeric,
  owner_quote_count integer not null default 0,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (candidate_opening_offer >= 0 and candidate_target_buy >= 0 and candidate_hard_max >= 0),
  check (final_opening_offer >= 0 and final_target_buy >= 0 and final_hard_max >= 0),
  check (final_opening_offer <= final_target_buy and final_target_buy <= final_hard_max)
);

alter table public.ai_buyer_owner_pricebook_reviews enable row level security;
revoke all on public.ai_buyer_owner_pricebook_reviews from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_owner_pricebook_reviews to service_role;

create or replace function public.ai_buyer_sync_owner_pricebook_reviews()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_inserted integer := 0;
begin
  with ins as (
    insert into public.ai_buyer_owner_pricebook_reviews(
      case_id,category,brand,model_name,model_code,
      candidate_opening_offer,candidate_target_buy,candidate_hard_max,
      final_opening_offer,final_target_buy,final_hard_max,
      candidate_confidence,identity_confidence,owner_quote_count
    )
    select
      c.case_id,c.category,c.brand,c.model_name,c.model_code,
      c.suggested_opening_offer,c.suggested_target_buy,c.suggested_hard_max,
      c.suggested_opening_offer,c.suggested_target_buy,c.suggested_hard_max,
      c.candidate_confidence,c.owner_identity_confidence,c.owner_quote_count
    from public.ai_buyer_owner_pricebook_candidates_v c
    where c.ready_for_pricebook_review
      and c.suggested_opening_offer is not null
      and c.suggested_target_buy is not null
      and c.suggested_hard_max is not null
    on conflict (case_id) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from ins;

  return jsonb_build_object('ok',true,'inserted',v_inserted,'generatedAt',now());
end;
$$;
revoke all on function public.ai_buyer_sync_owner_pricebook_reviews()
from public,anon,authenticated;
grant execute on function public.ai_buyer_sync_owner_pricebook_reviews()
to service_role;

select public.ai_buyer_sync_owner_pricebook_reviews();

create or replace view public.ai_buyer_owner_price_pair_v
with (security_invoker=true) as
select
  l.id as owner_label_id,
  l.case_id,
  l.conversation_id,
  c.category,
  c.title,
  s.model_name,
  s.model_code,
  s.pricing_decision_id,
  s.price_source,
  s.estimated_resale as ai_estimated_resale,
  s.opening_offer as ai_opening_offer,
  s.target_buy as ai_target_buy,
  s.hard_max as ai_hard_max,
  s.pricing_confidence as ai_pricing_confidence,
  nullif(l.payload->>'amount','')::numeric as owner_offer,
  coalesce(nullif(l.payload->>'sentAt','')::timestamptz,l.created_at) as owner_offer_at,
  s.captured_at as ai_snapshot_at,
  case when s.opening_offer > 0 then
    round(((nullif(l.payload->>'amount','')::numeric-s.opening_offer)/s.opening_offer)*100,2)
  end as owner_vs_ai_opening_pct,
  case when s.opening_offer > 0 then
    round(abs((nullif(l.payload->>'amount','')::numeric-s.opening_offer)/s.opening_offer)*100,2)
  end as abs_opening_error_pct,
  case when s.target_buy > 0 then
    round(((nullif(l.payload->>'amount','')::numeric-s.target_buy)/s.target_buy)*100,2)
  end as owner_vs_ai_target_pct,
  case when s.target_buy > 0 then
    round(abs((nullif(l.payload->>'amount','')::numeric-s.target_buy)/s.target_buy)*100,2)
  end as abs_target_error_pct,
  case when s.hard_max > 0 then
    round(((s.hard_max-nullif(l.payload->>'amount','')::numeric)/nullif(l.payload->>'amount','')::numeric)*100,2)
  end as ai_hardmax_over_owner_pct,
  (s.opening_offer > nullif(l.payload->>'amount','')::numeric * 1.10) as unsafe_ai_opening_over_10pct,
  (nullif(l.payload->>'amount','')::numeric > s.hard_max) as owner_exceeds_ai_hardmax,
  s.capture_key
from public.ai_buyer_learning_labels l
join public.ai_buyer_valuation_cases c on c.id=l.case_id
left join public.ai_buyer_owner_shadow_snapshots s on s.capture_key=l.source_ref
where l.label_type='PRICE_QUOTE'
  and l.verified=true
  and l.payload->>'actor'='OWNER_MANUAL'
  and nullif(l.payload->>'amount','') is not null;

revoke all on public.ai_buyer_owner_price_pair_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_price_pair_v to service_role;

create or replace view public.ai_buyer_owner_error_by_category_v
with (security_invoker=true) as
select
  category,
  count(*) filter (where ai_target_buy is not null)::int as paired_cases,
  round(avg(abs(owner_offer-ai_target_buy)) filter (where ai_target_buy is not null),2) as mae_baht,
  round(percentile_cont(0.5) within group (order by abs_opening_error_pct::double precision)
    filter (where abs_opening_error_pct is not null)::numeric,2) as median_abs_opening_error_pct,
  round(percentile_cont(0.5) within group (order by abs_target_error_pct::double precision)
    filter (where abs_target_error_pct is not null)::numeric,2) as median_abs_target_error_pct,
  round(avg(owner_vs_ai_opening_pct) filter (where owner_vs_ai_opening_pct is not null),2) as avg_owner_vs_ai_opening_pct,
  round(avg(owner_vs_ai_target_pct) filter (where owner_vs_ai_target_pct is not null),2) as avg_owner_vs_ai_target_pct,
  count(*) filter (where unsafe_ai_opening_over_10pct)::int as unsafe_ai_opening_over_10pct_cases,
  count(*) filter (where owner_exceeds_ai_hardmax)::int as owner_exceeds_ai_hardmax_cases
from public.ai_buyer_owner_price_pair_v
group by category;

revoke all on public.ai_buyer_owner_error_by_category_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_error_by_category_v to service_role;

create or replace view public.ai_buyer_owner_conversation_pair_v
with (security_invoker=true) as
select
  m.id as owner_message_id,
  m.case_id,
  m.conversation_id,
  c.category,
  c.title,
  s.id as shadow_id,
  s.action,
  s.draft_text as ai_draft,
  m.text_content as owner_actual,
  s.created_at as ai_draft_at,
  coalesce(m.line_timestamp,m.created_at) as owner_replied_at,
  char_length(s.draft_text) as ai_chars,
  char_length(coalesce(m.text_content,'')) as owner_chars,
  round(
    greatest(
      0,
      100 - (abs(char_length(s.draft_text)-char_length(coalesce(m.text_content,'')))::numeric
        / greatest(char_length(coalesce(m.text_content,'')),1) * 100)
    ),
    2
  ) as length_similarity_pct,
  (s.draft_text ilike '%ครับ%') as ai_uses_khrap,
  (coalesce(m.text_content,'') ilike '%ครับ%') as owner_uses_khrap,
  (s.draft_text ~ '[?？]') as ai_uses_question_mark,
  (coalesce(m.text_content,'') ~ '[?？]') as owner_uses_question_mark
from public.ai_buyer_messages m
join public.ai_buyer_valuation_cases c on c.id=m.case_id
left join lateral (
  select x.*
  from public.ai_buyer_owner_conversation_shadows x
  where x.case_id=m.case_id
    and x.created_at <= coalesce(m.line_timestamp,m.created_at)
    and x.created_at >= coalesce(m.line_timestamp,m.created_at)-interval '24 hours'
  order by x.created_at desc
  limit 1
) s on true
where m.direction='OUTBOUND'
  and coalesce(m.metadata->>'source','')='OWNER_MANUAL'
  and m.message_type='TEXT';

revoke all on public.ai_buyer_owner_conversation_pair_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_conversation_pair_v to service_role;

create or replace view public.ai_buyer_owner_style_profile_v
with (security_invoker=true) as
select
  count(*)::int as owner_messages,
  round(avg(char_length(text_content))::numeric,1) as avg_chars,
  percentile_cont(0.5) within group (order by char_length(text_content))::numeric as median_chars,
  round(100.0*avg((text_content ilike '%ครับ%')::int),1) as pct_with_khrap,
  round(100.0*avg((text_content ~ '[?？]')::int),1) as pct_question_mark,
  round(100.0*avg((text_content ~ '(ส่งรูป|ขอรูป|รูป.*หลาย|รูป.*มุม)')::int),1) as pct_photo_request,
  round(100.0*avg((text_content ~ '(อยู่จังหวัด|จังหวัดไหน)')::int),1) as pct_location_question,
  (select count(*)::int from public.ai_buyer_owner_conversation_pair_v where shadow_id is not null) as shadow_owner_pairs,
  (select round(percentile_cont(0.5) within group(order by length_similarity_pct::double precision)::numeric,2)
   from public.ai_buyer_owner_conversation_pair_v where shadow_id is not null) as median_length_similarity_pct
from public.ai_buyer_learning_events
where speaker='OWNER_MANUAL'
  and message_type='TEXT'
  and coalesce(text_content,'') <> '';

revoke all on public.ai_buyer_owner_style_profile_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_style_profile_v to service_role;

create or replace view public.ai_buyer_owner_review_training_v
with (security_invoker=true) as
select
  r.case_id,r.category,r.brand,r.model_name,r.model_code,r.status,
  r.candidate_opening_offer,r.candidate_target_buy,r.candidate_hard_max,
  r.final_opening_offer,r.final_target_buy,r.final_hard_max,
  case when r.candidate_opening_offer > 0
    then round(((r.final_opening_offer-r.candidate_opening_offer)/r.candidate_opening_offer)*100,2)
  end as opening_adjustment_pct,
  case when r.candidate_target_buy > 0
    then round(((r.final_target_buy-r.candidate_target_buy)/r.candidate_target_buy)*100,2)
  end as target_adjustment_pct,
  case when r.candidate_hard_max > 0
    then round(((r.final_hard_max-r.candidate_hard_max)/r.candidate_hard_max)*100,2)
  end as hardmax_adjustment_pct,
  r.reviewed_by,r.reviewed_at,r.review_note
from public.ai_buyer_owner_pricebook_reviews r
where r.status in ('APPROVED','REJECTED');

revoke all on public.ai_buyer_owner_review_training_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_review_training_v to service_role;

create or replace view public.ai_buyer_owner_deal_economics_v
with (security_invoker=true) as
select
  d.case_id,
  c.category,
  c.title,
  d.final_label,
  d.final_agreed_price,
  d.outcome_purchase_price,
  d.purchase_total,
  d.repair_total,
  d.parts_total,
  d.transport_total,
  d.warranty_total,
  d.channel_fee_total,
  d.other_cost_total,
  d.total_cost,
  d.sale_total,
  d.gross_profit,
  d.first_acquired_at,
  d.last_sold_at,
  d.sold_lines,
  d.in_stock_lines,
  case
    when d.first_acquired_at is not null and d.last_sold_at is not null
    then round((extract(epoch from (d.last_sold_at-d.first_acquired_at))/86400.0)::numeric,1)
  end as holding_days,
  case when d.total_cost > 0 and d.gross_profit is not null
    then round((d.gross_profit/d.total_cost*100)::numeric,2)
  end as roi_pct,
  case when d.sale_total > 0 and d.gross_profit is not null
    then round((d.gross_profit/d.sale_total*100)::numeric,2)
  end as gross_margin_pct,
  p.first_high_conf_owner_offer as owner_opening_offer,
  p.last_owner_offer as owner_last_offer,
  s.opening_offer as ai_opening_offer,
  s.target_buy as ai_target_buy,
  s.hard_max as ai_hard_max
from public.ai_buyer_deal_ledger_case_v d
join public.ai_buyer_valuation_cases c on c.id=d.case_id
left join public.ai_buyer_owner_case_price_v p on p.case_id=d.case_id
left join lateral (
  select x.*
  from public.ai_buyer_owner_shadow_snapshots x
  where x.case_id=d.case_id and x.target_buy is not null
  order by x.captured_at desc
  limit 1
) s on true;

revoke all on public.ai_buyer_owner_deal_economics_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_deal_economics_v to service_role;

create or replace view public.ai_buyer_owner_deal_economics_by_category_v
with (security_invoker=true) as
select
  category,
  count(*) filter (where sold_lines > 0 and gross_profit is not null)::int as sold_cases,
  round(avg(gross_profit) filter (where sold_lines > 0 and gross_profit is not null),2) as avg_gross_profit,
  round(avg(roi_pct) filter (where roi_pct is not null),2) as avg_roi_pct,
  round(percentile_cont(0.5) within group(order by holding_days::double precision)
    filter (where holding_days is not null)::numeric,1) as median_holding_days,
  round(avg(gross_margin_pct) filter (where gross_margin_pct is not null),2) as avg_gross_margin_pct
from public.ai_buyer_owner_deal_economics_v
group by category;

revoke all on public.ai_buyer_owner_deal_economics_by_category_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_deal_economics_by_category_v to service_role;

create or replace view public.ai_buyer_owner_promotion_gate_v
with (security_invoker=true) as
with latest_run as (
  select id,status,regression_cases,started_at
  from public.ai_buyer_offline_replay_runs
  order by started_at desc
  limit 1
),
replay as (
  select
    r.category,
    count(*)::int as replay_cases,
    count(*) filter (
      where jsonb_typeof(r.regression_codes)='array'
        and jsonb_array_length(r.regression_codes)>0
    )::int as regression_cases
  from public.ai_buyer_offline_replay_results r
  join latest_run l on l.id=r.run_id
  group by r.category
),
conv as (
  select category,count(*) filter (where shadow_id is not null)::int as conversation_pairs
  from public.ai_buyer_owner_conversation_pair_v
  group by category
)
select
  m.category,
  m.mode as current_mode,
  coalesce(e.paired_cases,0) as paired_cases,
  e.median_abs_opening_error_pct,
  e.median_abs_target_error_pct,
  coalesce(e.unsafe_ai_opening_over_10pct_cases,0) as unsafe_ai_opening_over_10pct_cases,
  coalesce(e.owner_exceeds_ai_hardmax_cases,0) as owner_exceeds_ai_hardmax_cases,
  coalesce(conv.conversation_pairs,0) as conversation_pairs,
  coalesce(replay.replay_cases,0) as replay_cases,
  coalesce(replay.regression_cases,0) as replay_regression_cases,
  l.status as latest_replay_status,
  coalesce(ec.sold_cases,0) as sold_economic_cases,
  (
    coalesce(e.paired_cases,0) >= 20
    and coalesce(e.median_abs_opening_error_pct,999) <= 10
    and coalesce(e.unsafe_ai_opening_over_10pct_cases,0)=0
    and coalesce(conv.conversation_pairs,0) >= 20
    and coalesce(replay.regression_cases,0)=0
    and l.status='SUCCEEDED'
  ) as ready_for_approval_review,
  array_remove(array[
    case when coalesce(e.paired_cases,0)<20 then 'NEED_20_PRICE_PAIRS' end,
    case when coalesce(e.median_abs_opening_error_pct,999)>10 then 'OPENING_ERROR_OVER_10PCT' end,
    case when coalesce(e.unsafe_ai_opening_over_10pct_cases,0)>0 then 'UNSAFE_OPENING_OVER_OWNER' end,
    case when coalesce(conv.conversation_pairs,0)<20 then 'NEED_20_CONVERSATION_PAIRS' end,
    case when coalesce(replay.regression_cases,0)>0 then 'REPLAY_REGRESSION' end,
    case when coalesce(l.status,'')<>'SUCCEEDED' then 'REPLAY_NOT_SUCCEEDED' end
  ],null) as blockers
from public.ai_buyer_category_automation_modes m
left join public.ai_buyer_owner_error_by_category_v e using(category)
left join conv using(category)
left join replay using(category)
cross join latest_run l
left join public.ai_buyer_owner_deal_economics_by_category_v ec using(category)
where m.active=true;

revoke all on public.ai_buyer_owner_promotion_gate_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_promotion_gate_v to service_role;

create or replace view public.ai_buyer_owner_model_v2_status_v
with (security_invoker=true) as
select
  b.*,
  (select count(*)::int from public.ai_buyer_owner_price_pair_v where ai_target_buy is not null) as paired_pricing_cases,
  (select count(*)::int from public.ai_buyer_owner_conversation_pair_v where shadow_id is not null) as conversation_shadow_pairs,
  (select count(*)::int from public.ai_buyer_owner_pricebook_reviews where status='PENDING') as pending_pricebook_reviews,
  (select count(*)::int from public.ai_buyer_owner_pricebook_reviews where status='APPROVED') as approved_pricebook_reviews,
  (select count(*)::int from public.ai_buyer_owner_deal_economics_v where sold_lines>0 and gross_profit is not null) as sold_economic_cases,
  (select count(*)::int from public.ai_buyer_owner_promotion_gate_v where ready_for_approval_review) as promotion_ready_categories,
  now() as v2_generated_at
from public.ai_buyer_owner_model_status_v b;

revoke all on public.ai_buyer_owner_model_v2_status_v from public,anon,authenticated;
grant select on public.ai_buyer_owner_model_v2_status_v to service_role;


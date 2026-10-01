-- V2.7 calibration audit surface.
-- Model-specific owner calibration is allowed with exact/strong identity.
-- Category-wide factors remain blocked until sufficient AI↔Owner paired cases exist.

create or replace view public.ai_buyer_v27_calibration_status_v
with (security_invoker=true) as
with active_version as (
  select id,version_name,activated_at
  from public.ai_buyer_price_book_versions
  where status='ACTIVE'
  order by activated_at desc nulls last,created_at desc
  limit 1
),
pair_stats as (
  select
    count(*)::int as paired_cases,
    count(distinct category)::int as paired_categories
  from public.ai_buyer_owner_price_pair_v
  where ai_target_buy is not null
),
reviews as (
  select
    count(*) filter (where status='APPROVED')::int as approved_reviews,
    count(*) filter (where status='PENDING')::int as pending_reviews,
    count(*) filter (where status='REJECTED')::int as rejected_reviews
  from public.ai_buyer_owner_pricebook_reviews
),
entries as (
  select
    count(*) filter (where e.active)::int as active_entries,
    count(*) filter (where not e.active)::int as review_only_entries
  from public.ai_buyer_price_book_entries e
  join active_version v on v.id=e.version_id
)
select
  v.id as version_id,
  v.version_name,
  v.activated_at,
  e.active_entries,
  e.review_only_entries,
  r.approved_reviews,
  r.pending_reviews,
  r.rejected_reviews,
  p.paired_cases,
  p.paired_categories,
  (p.paired_cases >= 20) as category_factor_calibration_allowed,
  case
    when p.paired_cases >= 20 then 'PAIRED_CALIBRATION_AVAILABLE'
    else 'MODEL_SPECIFIC_ONLY_NO_GLOBAL_FACTOR'
  end as calibration_mode,
  now() as generated_at
from active_version v
cross join pair_stats p
cross join reviews r
cross join entries e;

revoke all on public.ai_buyer_v27_calibration_status_v from public,anon,authenticated;
grant select on public.ai_buyer_v27_calibration_status_v to service_role;

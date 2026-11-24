-- AMPHON SEO Phase 4, P1. Aggregate ONLY actual contact-click and verified
-- purchase/sale evidence. Not a click->lead or organic->revenue inference.
-- Privacy: no token, session key, lead reference, customer identity or SKU.
create or replace view public.commerce_seo_portfolio_attribution_readiness_v
with (security_invoker=true)
as
with contacts as (
  select c.site_id,
    count(*)::bigint as contact_click_events,
    count(*) filter (where c.source_channel='ORGANIC_SEARCH')::bigint as organic_search_labeled_clicks,
    count(*) filter (where c.source_channel='AI_REFERRAL')::bigint as ai_referral_labeled_clicks,
    count(*) filter (where c.source_channel='UNKNOWN')::bigint as unknown_channel_clicks,
    count(*) filter (where c.confirmed_lead)::bigint as owner_confirmed_leads,
    count(*) filter (where c.lead_reference is not null and btrim(c.lead_reference)<>'')::bigint as clicks_with_lead_reference,
    count(*) filter (where c.sale_id is not null)::bigint as clicks_with_sale_reference,
    count(*) filter (where not c.confirmed_lead)::bigint as clicks_not_confirmed_as_lead,
    max(c.created_at) as latest_click_at
  from public.commerce_seo_contact_events c
  group by c.site_id
), deals as (
  select a.site_id,
    count(*)::bigint as attribution_records,
    count(*) filter (where a.attribution_status='PENDING')::bigint as attribution_pending,
    count(*) filter (where a.attribution_status='MATCHED_UNVERIFIED')::bigint as attribution_matched_unverified,
    count(*) filter (where a.attribution_status='REJECTED')::bigint as attribution_rejected,
    count(*) filter (where a.attribution_status in ('PURCHASE_VERIFIED','SOLD_VERIFIED')
      and a.purchase_verified_at is not null
      and nullif(btrim(a.verification_source),'') is not null
      and nullif(btrim(a.evidence_ref),'') is not null
      and (a.contact_event_id is not null or nullif(btrim(a.lead_reference),'') is not null)
    )::bigint as evidence_verified_purchases,
    coalesce(sum(a.quantity) filter (where a.attribution_status in ('PURCHASE_VERIFIED','SOLD_VERIFIED')
      and a.purchase_verified_at is not null
      and nullif(btrim(a.verification_source),'') is not null
      and nullif(btrim(a.evidence_ref),'') is not null
      and (a.contact_event_id is not null or nullif(btrim(a.lead_reference),'') is not null)
    ),0)::bigint as evidence_verified_units,
    count(*) filter (where a.attribution_status='SOLD_VERIFIED'
      and a.purchase_verified_at is not null and a.sold_verified_at is not null
      and a.quantity>0 and a.sale_revenue is not null
      and a.acquisition_cost is not null and a.realized_gross_profit is not null
      and nullif(btrim(a.verification_source),'') is not null
      and nullif(btrim(a.evidence_ref),'') is not null
      and (a.contact_event_id is not null or nullif(btrim(a.lead_reference),'') is not null)
    )::bigint as evidence_verified_sales,
    coalesce(sum(a.realized_gross_profit) filter (where a.attribution_status='SOLD_VERIFIED'
      and a.purchase_verified_at is not null and a.sold_verified_at is not null
      and a.quantity>0 and a.sale_revenue is not null
      and a.acquisition_cost is not null and a.realized_gross_profit is not null
      and nullif(btrim(a.verification_source),'') is not null
      and nullif(btrim(a.evidence_ref),'') is not null
      and (a.contact_event_id is not null or nullif(btrim(a.lead_reference),'') is not null)
    ),0)::numeric as evidence_verified_realized_gross_profit,
    count(*) filter (where a.contact_event_id is not null and
      (c.site_id is null or c.site_id<>a.site_id))::bigint as cross_site_contact_link_warnings,
    max(a.updated_at) as latest_attribution_at
  from public.commerce_seo_portfolio_attributions a
  left join public.commerce_seo_contact_events c on c.id=a.contact_event_id
  group by a.site_id
)
select s.id as site_id,s.label,s.enabled as site_enabled,
 coalesce(c.contact_click_events,0)::bigint as contact_click_events,
 coalesce(c.organic_search_labeled_clicks,0)::bigint as organic_search_labeled_clicks,
 coalesce(c.ai_referral_labeled_clicks,0)::bigint as ai_referral_labeled_clicks,
 coalesce(c.unknown_channel_clicks,0)::bigint as unknown_channel_clicks,
 coalesce(c.owner_confirmed_leads,0)::bigint as owner_confirmed_leads,
 coalesce(c.clicks_with_lead_reference,0)::bigint as clicks_with_lead_reference,
 coalesce(c.clicks_with_sale_reference,0)::bigint as clicks_with_sale_reference,
 coalesce(c.clicks_not_confirmed_as_lead,0)::bigint as clicks_not_confirmed_as_lead,
 coalesce(d.attribution_records,0)::bigint as attribution_records,
 coalesce(d.attribution_pending,0)::bigint as attribution_pending,
 coalesce(d.attribution_matched_unverified,0)::bigint as attribution_matched_unverified,
 coalesce(d.attribution_rejected,0)::bigint as attribution_rejected,
 coalesce(d.evidence_verified_purchases,0)::bigint as evidence_verified_purchases,
 coalesce(d.evidence_verified_units,0)::bigint as evidence_verified_units,
 coalesce(d.evidence_verified_sales,0)::bigint as evidence_verified_sales,
 coalesce(d.evidence_verified_realized_gross_profit,0)::numeric as evidence_verified_realized_gross_profit,
 coalesce(d.cross_site_contact_link_warnings,0)::bigint as cross_site_contact_link_warnings,
 c.latest_click_at,d.latest_attribution_at,
 case when not s.enabled then 'SITE_DISABLED'
  when coalesce(c.contact_click_events,0)=0 then 'NO_CLICK_EVIDENCE'
  when coalesce(d.cross_site_contact_link_warnings,0)>0 then 'CROSS_SITE_LINK_REVIEW_REQUIRED'
  when coalesce(d.evidence_verified_sales,0)>0 then 'REALIZED_SALE_EVIDENCED'
  when coalesce(d.evidence_verified_purchases,0)>0 then 'PURCHASE_EVIDENCED_SALE_PENDING'
  when coalesce(c.owner_confirmed_leads,0)>0 then 'LEADS_CONFIRMED_PURCHASE_PENDING'
  else 'CLICK_ONLY_NO_CONFIRMED_LEAD'
 end as evidence_stage,
 'CLICK_EVENT_IS_NOT_A_CONFIRMED_LINE_CONVERSATION_OR_BUYBACK'::text as measurement_warning
from public.commerce_seo_sites s
left join contacts c on c.site_id=s.id
left join deals d on d.site_id=s.id;

-- This daily source bucket supports trend charts without leaking original
-- lead token, session IDs, customer details or URL queries.
create or replace view public.commerce_seo_portfolio_contact_source_daily_v
with (security_invoker=true)
as
select c.site_id,c.event_day,c.source_channel,
 count(*)::bigint as click_events,
 count(*) filter (where c.confirmed_lead)::bigint as owner_confirmed_leads,
 count(*) filter (where c.lead_reference is not null and btrim(c.lead_reference)<>'')::bigint as clicks_with_lead_reference,
 count(*) filter (where c.sale_id is not null)::bigint as clicks_with_sale_reference
from public.commerce_seo_contact_events c
group by c.site_id,c.event_day,c.source_channel;

revoke all on public.commerce_seo_portfolio_attribution_readiness_v,
 public.commerce_seo_portfolio_contact_source_daily_v from public, anon, authenticated;
grant select on public.commerce_seo_portfolio_attribution_readiness_v,
 public.commerce_seo_portfolio_contact_source_daily_v to service_role;

comment on view public.commerce_seo_portfolio_attribution_readiness_v is
 'Service-only aggregate click -> owner-confirmed lead -> evidence-verified purchase/sale, no PII; never claim a click as a customer or profit without verification.';
comment on view public.commerce_seo_portfolio_contact_source_daily_v is
 'Service-only daily counts by site/channel; referrer classification is self-reported, not independently verified SERP or GSC clicks.';

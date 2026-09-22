-- Invalidate undelivered stale pricing after active Price Book calibration.
-- Keeps decision history for audit; supersedes only undelivered shadow offers.

do $$
declare
  v_active uuid;
begin
  select id into v_active
  from public.ai_buyer_price_book_versions
  where status='ACTIVE'
  order by activated_at desc nulls last, created_at desc
  limit 1;

  if v_active is null then
    raise exception 'AI Buyer active price book missing';
  end if;

  with latest as (
    select distinct on (d.case_id)
      d.case_id,d.id as decision_id,d.price_book_version_id
    from public.ai_buyer_pricing_decisions d
    order by d.case_id,d.created_at desc
  ),
  stale as (
    select l.case_id,l.decision_id,l.price_book_version_id
    from latest l
    join public.ai_buyer_valuation_cases c on c.id=l.case_id
    where c.state='PRICING'
      and l.price_book_version_id is not null
      and l.price_book_version_id<>v_active
      and not exists (
        select 1
        from public.ai_buyer_offers o
        where o.pricing_decision_id=l.decision_id
          and o.delivered_at is not null
      )
  )
  update public.ai_buyer_offers o
  set status='SUPERSEDED'
  from stale s
  where o.pricing_decision_id=s.decision_id
    and o.delivered_at is null
    and o.status='PROPOSED';

  with latest as (
    select distinct on (d.case_id)
      d.case_id,d.id as decision_id,d.price_book_version_id
    from public.ai_buyer_pricing_decisions d
    order by d.case_id,d.created_at desc
  ),
  stale as (
    select l.case_id,l.decision_id,l.price_book_version_id
    from latest l
    join public.ai_buyer_valuation_cases c on c.id=l.case_id
    where c.state='PRICING'
      and l.price_book_version_id is not null
      and l.price_book_version_id<>v_active
      and not exists (
        select 1
        from public.ai_buyer_offers o
        where o.pricing_decision_id=l.decision_id
          and o.delivered_at is not null
      )
  )
  update public.ai_buyer_valuation_cases c
  set state='READY_TO_PRICE',
      metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
        'pricingReviewReason','STALE_PRICING_DECISION_REPRICE_REQUIRED',
        'stalePricingDecisionId',s.decision_id,
        'stalePriceBookVersionId',s.price_book_version_id,
        'activePriceBookVersionId',v_active,
        'stalePricingInvalidatedAt',now()
      )
  from stale s
  where c.id=s.case_id;
end $$;

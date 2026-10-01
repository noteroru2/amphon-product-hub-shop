-- V2.7 replay wrapper.
-- Reuses the proven deterministic readiness replay and records the full dataset
-- scope (including terminal/excluded cases) plus active PriceBook context.

create or replace function public.ai_buyer_run_offline_replay_v27()
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run uuid;
  v_total integer;
  v_eligible integer;
  v_terminal integer;
  v_pricebook text;
  v_active_entries integer;
  v_inactive_entries integer;
  v_owner_quote_cases integer;
  v_approved_reviews integer;
  v_pending_reviews integer;
  v_summary jsonb;
begin
  select count(*)::int into v_total
  from public.ai_buyer_valuation_cases;

  select count(*)::int into v_eligible
  from public.ai_buyer_learning_deal_dataset_v
  where training_eligible;

  select count(*)::int into v_terminal
  from public.ai_buyer_valuation_cases
  where state in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED');

  select version_name into v_pricebook
  from public.ai_buyer_price_book_versions
  where status='ACTIVE'
  order by activated_at desc nulls last,created_at desc
  limit 1;

  select count(*) filter (where e.active)::int,
         count(*) filter (where not e.active)::int
  into v_active_entries,v_inactive_entries
  from public.ai_buyer_price_book_entries e
  join public.ai_buyer_price_book_versions v on v.id=e.version_id
  where v.status='ACTIVE';

  select count(distinct case_id)::int into v_owner_quote_cases
  from public.ai_buyer_owner_price_dataset_v
  where high_confidence_owner_quote;

  select count(*) filter (where status='APPROVED')::int,
         count(*) filter (where status='PENDING')::int
  into v_approved_reviews,v_pending_reviews
  from public.ai_buyer_owner_pricebook_reviews;

  v_run := public.ai_buyer_run_offline_replay('AMPHON_AI_BUYER_V27_APPROVAL');

  select coalesce(summary,'{}'::jsonb)
  into v_summary
  from public.ai_buyer_offline_replay_runs
  where id=v_run;

  update public.ai_buyer_offline_replay_runs
  set summary = v_summary || jsonb_build_object(
    'datasetTotal',v_total,
    'trainingEligible',v_eligible,
    'terminalExcluded',v_terminal,
    'activeReplayed',total_cases,
    'activePriceBook',v_pricebook,
    'activePriceBookEntries',coalesce(v_active_entries,0),
    'inactiveReviewEntries',coalesce(v_inactive_entries,0),
    'highConfidenceOwnerQuoteCases',coalesce(v_owner_quote_cases,0),
    'approvedOwnerReviews',coalesce(v_approved_reviews,0),
    'pendingOwnerReviews',coalesce(v_pending_reviews,0),
    'replayMode','V2.7_APPROVAL_PREOPEN'
  )
  where id=v_run;

  return v_run;
end;
$$;

revoke all on function public.ai_buyer_run_offline_replay_v27()
from public,anon,authenticated;
grant execute on function public.ai_buyer_run_offline_replay_v27()
to service_role;

-- AMPHON AI Buyer V1 — Checkpoint 4 RPC ambiguity fix
-- Production follow-up migration corresponding to the runtime fix discovered by E2E.

create or replace function public.ai_buyer_create_guarded_offer(
  p_case_id uuid,
  p_decision_id uuid,
  p_amount numeric,
  p_actor text,
  p_idempotency_key text,
  p_round_no integer default 0,
  p_message_id uuid default null
)
returns table(id uuid, amount numeric)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_case_state text;
  v_case_accepted_at timestamptz;
  v_hard_max numeric(12,2);
  v_current numeric(12,2);
  v_confidence numeric;
  v_decision_case uuid;
  v_existing public.ai_buyer_offers%rowtype;
  v_offer public.ai_buyer_offers%rowtype;
begin
  if p_actor not in ('AI','ADMIN') then raise exception 'AI_BUYER_OFFER_ACTOR_INVALID'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'AI_BUYER_OFFER_AMOUNT_INVALID'; end if;
  if coalesce(trim(p_idempotency_key),'') = '' then raise exception 'AI_BUYER_OFFER_IDEMPOTENCY_REQUIRED'; end if;

  select vc.state, vc.accepted_at into v_case_state, v_case_accepted_at
  from public.ai_buyer_valuation_cases vc
  where vc.id = p_case_id
  for update;

  if not found then raise exception 'AI_BUYER_CASE_NOT_FOUND'; end if;
  if v_case_accepted_at is not null
     or v_case_state in ('ACCEPTED','COLLECTING_FULFILLMENT','ACTION_REQUIRED','ADMIN_ASSIGNED','COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  then raise exception 'AI_BUYER_NEGOTIATION_CLOSED'; end if;

  select pd.case_id, pd.hard_max, pd.current_authorized_offer, pd.pricing_confidence
  into v_decision_case, v_hard_max, v_current, v_confidence
  from public.ai_buyer_pricing_decisions pd
  where pd.id = p_decision_id
  for update;

  if not found or v_decision_case is distinct from p_case_id then raise exception 'AI_BUYER_PRICING_DECISION_INVALID'; end if;
  if v_confidence < 0.85 then raise exception 'AI_BUYER_PRICING_CONFIDENCE_LOW'; end if;
  if p_amount > v_hard_max then raise exception 'AI_BUYER_HARD_MAX_EXCEEDED'; end if;
  if p_amount < v_current then raise exception 'AI_BUYER_OFFER_MUST_BE_MONOTONIC'; end if;

  select o.* into v_existing
  from public.ai_buyer_offers o
  where o.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.case_id <> p_case_id
       or v_existing.pricing_decision_id <> p_decision_id
       or v_existing.amount <> p_amount
    then raise exception 'AI_BUYER_OFFER_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id, v_existing.amount;
    return;
  end if;

  insert into public.ai_buyer_offers(
    case_id, pricing_decision_id, amount, actor, status, message_id,
    idempotency_key, round_no
  ) values (
    p_case_id, p_decision_id, round(p_amount), p_actor, 'PROPOSED', p_message_id,
    p_idempotency_key, greatest(0, coalesce(p_round_no,0))
  )
  returning * into v_offer;

  update public.ai_buyer_offers o
  set status = 'SUPERSEDED'
  where o.case_id = p_case_id
    and o.status = 'PROPOSED'
    and o.id <> v_offer.id;

  update public.ai_buyer_pricing_decisions pd
  set current_authorized_offer = greatest(pd.current_authorized_offer, round(p_amount))
  where pd.id = p_decision_id;

  return query select v_offer.id, v_offer.amount;
end;
$fn$;

revoke all on function public.ai_buyer_create_guarded_offer(uuid,uuid,numeric,text,text,integer,uuid)
from public, anon, authenticated;
grant execute on function public.ai_buyer_create_guarded_offer(uuid,uuid,numeric,text,text,integer,uuid)
to service_role;

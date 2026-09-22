-- AMPHON AI Buyer V1 — Checkpoint 4 foreign-key index hardening

drop index if exists public.ai_buyer_negotiation_decision_idx;
create index ai_buyer_negotiation_decision_idx
  on public.ai_buyer_negotiation_events(pricing_decision_id);

drop index if exists public.ai_buyer_negotiation_offer_idx;
create index ai_buyer_negotiation_offer_idx
  on public.ai_buyer_negotiation_events(offer_id);

drop index if exists public.ai_buyer_negotiation_message_idx;
create index ai_buyer_negotiation_message_idx
  on public.ai_buyer_negotiation_events(inbound_message_id);

create index if not exists ai_buyer_outbound_conversation_idx
  on public.ai_buyer_outbound_actions(conversation_id);

drop index if exists public.ai_buyer_outbound_offer_idx;
create index ai_buyer_outbound_offer_idx
  on public.ai_buyer_outbound_actions(offer_id);

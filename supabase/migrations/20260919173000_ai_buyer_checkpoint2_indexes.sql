-- AMPHON AI Buyer V1 — Checkpoint 2 performance indexes

create index if not exists ai_buyer_conversations_customer_idx
  on public.ai_buyer_conversations(customer_id);

create index if not exists ai_buyer_cases_customer_idx
  on public.ai_buyer_valuation_cases(customer_id);

create index if not exists ai_buyer_messages_webhook_event_idx
  on public.ai_buyer_messages(webhook_event_id)
  where webhook_event_id is not null;

create index if not exists ai_buyer_images_message_idx
  on public.ai_buyer_case_images(message_id)
  where message_id is not null;

create index if not exists ai_buyer_images_analysis_run_idx
  on public.ai_buyer_case_images(last_analysis_run_id)
  where last_analysis_run_id is not null;

create index if not exists ai_buyer_analysis_conversation_idx
  on public.ai_buyer_analysis_runs(conversation_id, started_at desc);

create index if not exists ai_buyer_pricing_version_idx
  on public.ai_buyer_pricing_decisions(price_book_version_id)
  where price_book_version_id is not null;

create index if not exists ai_buyer_pricing_entry_idx
  on public.ai_buyer_pricing_decisions(price_book_entry_id)
  where price_book_entry_id is not null;

create index if not exists ai_buyer_offers_case_idx
  on public.ai_buyer_offers(case_id, created_at desc);

create index if not exists ai_buyer_offers_pricing_idx
  on public.ai_buyer_offers(pricing_decision_id);

create index if not exists ai_buyer_offers_message_idx
  on public.ai_buyer_offers(message_id)
  where message_id is not null;

create index if not exists ai_buyer_tasks_case_idx
  on public.ai_buyer_admin_tasks(case_id, created_at desc);

create index if not exists ai_buyer_overrides_case_idx
  on public.ai_buyer_human_overrides(case_id, created_at desc);

create index if not exists ai_buyer_overrides_pricing_idx
  on public.ai_buyer_human_overrides(pricing_decision_id)
  where pricing_decision_id is not null;

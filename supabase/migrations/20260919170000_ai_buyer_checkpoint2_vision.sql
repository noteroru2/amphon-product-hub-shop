-- AMPHON AI Buyer V1 — Checkpoint 2: Conversation + Vision Intake

create table if not exists public.ai_buyer_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  provider text not null default 'OPENAI',
  model text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  trigger_message_ids jsonb not null default '[]'::jsonb,
  image_ids jsonb not null default '[]'::jsonb,
  input_summary jsonb not null default '{}'::jsonb,
  output jsonb,
  usage jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_buyer_analysis_case_idx
  on public.ai_buyer_analysis_runs(case_id, started_at desc);

alter table public.ai_buyer_analysis_runs enable row level security;

comment on table public.ai_buyer_analysis_runs is
  'Auditable Conversation + Vision intake runs. Stores structured operational output, not hidden chain-of-thought.';

alter table public.ai_buyer_case_images
  add column if not exists last_analysis_run_id uuid references public.ai_buyer_analysis_runs(id) on delete set null;

alter table public.ai_buyer_messages
  add column if not exists analysis_consumed_at timestamptz;

create index if not exists ai_buyer_messages_unconsumed_idx
  on public.ai_buyer_messages(case_id, created_at)
  where analysis_consumed_at is null;

comment on column public.ai_buyer_messages.analysis_consumed_at is
  'Set when this inbound message has been included in a successful intake analysis.';

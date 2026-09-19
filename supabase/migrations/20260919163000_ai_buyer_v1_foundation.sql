-- AMPHON AI Buyer V1 foundation
-- Locked Product Spec: photo-first LINE OA intake, auditable pricing, human override.

create extension if not exists pgcrypto;

create or replace function public.ai_buyer_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.ai_buyer_customers (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  picture_url text,
  language text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ai_buyer_customers(id) on delete cascade,
  line_user_id text not null unique,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CLOSED','BLOCKED')),
  control_mode text not null default 'AUTO' check (control_mode in ('AUTO','HUMAN_REQUIRED','HUMAN_ACTIVE')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_valuation_cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  customer_id uuid not null references public.ai_buyer_customers(id) on delete cascade,
  state text not null default 'NEW' check (
    state in (
      'NEW','IDENTIFYING_PRODUCT','COLLECTING_PHOTOS','ANALYZING','NEED_MORE_INFO',
      'READY_TO_PRICE','PRICING','OFFERED','NEGOTIATING','ACCEPTED',
      'COLLECTING_FULFILLMENT','ACTION_REQUIRED','ADMIN_ASSIGNED','COMPLETED',
      'HUMAN_REVIEW','CUSTOMER_DECLINED','EXPIRED','CANCELLED'
    )
  ),
  category text check (category in ('NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER')),
  title text,
  control_mode text not null default 'AUTO' check (control_mode in ('AUTO','HUMAN_REQUIRED','HUMAN_ACTIVE')),
  identity_confidence numeric(5,4),
  spec_completeness numeric(5,4),
  condition_completeness numeric(5,4),
  pricing_readiness numeric(5,4),
  accepted_price numeric(12,2),
  accepted_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_webhook_events (
  webhook_event_id text primary key,
  event_type text not null,
  line_user_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  case_id uuid references public.ai_buyer_valuation_cases(id) on delete set null,
  webhook_event_id text references public.ai_buyer_webhook_events(webhook_event_id) on delete set null,
  line_message_id text unique,
  direction text not null check (direction in ('INBOUND','OUTBOUND','SYSTEM')),
  message_type text not null check (message_type in ('TEXT','IMAGE','LOCATION','VIDEO','AUDIO','FILE','STICKER','OTHER')),
  text_content text,
  metadata jsonb not null default '{}'::jsonb,
  line_timestamp timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_case_images (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  message_id uuid references public.ai_buyer_messages(id) on delete set null,
  line_message_id text not null unique,
  storage_key text not null,
  mime_type text,
  byte_size bigint,
  image_set_id text,
  image_set_index integer,
  image_set_total integer,
  analysis_status text not null default 'PENDING' check (analysis_status in ('PENDING','READY','PROCESSING','ANALYZED','FAILED')),
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);

create table if not exists public.ai_buyer_product_observations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  source text not null check (source in ('CUSTOMER_TEXT','IMAGE','SYSTEM','ADMIN')),
  confirmed jsonb not null default '{}'::jsonb,
  inferred jsonb not null default '{}'::jsonb,
  unknown_fields jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  model_name text,
  model_code text,
  category text,
  identity_confidence numeric(5,4),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_price_book_versions (
  id uuid primary key default gen_random_uuid(),
  version_name text not null unique,
  status text not null default 'DRAFT' check (status in ('DRAFT','ACTIVE','ARCHIVED')),
  source_name text,
  source_checksum text,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_buyer_price_book_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.ai_buyer_price_book_versions(id) on delete cascade,
  category text not null,
  brand text,
  model text not null,
  model_code text,
  aliases jsonb not null default '[]'::jsonb,
  spec_match jsonb not null default '{}'::jsonb,
  condition_key text not null default 'NORMAL',
  estimated_resale numeric(12,2),
  opening_offer numeric(12,2) not null,
  target_buy numeric(12,2) not null,
  hard_max numeric(12,2) not null,
  adjustments jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opening_offer >= 0 and target_buy >= opening_offer and hard_max >= target_buy)
);

create table if not exists public.ai_buyer_pricing_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  price_source text not null check (price_source in ('PRICE_BOOK','MARKET','ADMIN')),
  price_book_version_id uuid references public.ai_buyer_price_book_versions(id) on delete set null,
  price_book_entry_id uuid references public.ai_buyer_price_book_entries(id) on delete set null,
  estimated_resale numeric(12,2),
  opening_offer numeric(12,2) not null,
  target_buy numeric(12,2) not null,
  hard_max numeric(12,2) not null,
  current_authorized_offer numeric(12,2) not null,
  pricing_confidence numeric(5,4) not null,
  adjustments jsonb not null default '[]'::jsonb,
  comparables jsonb not null default '[]'::jsonb,
  rationale jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (opening_offer >= 0 and target_buy >= opening_offer and hard_max >= target_buy),
  check (current_authorized_offer >= 0 and current_authorized_offer <= hard_max),
  check (pricing_confidence >= 0 and pricing_confidence <= 1)
);

create table if not exists public.ai_buyer_offers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  pricing_decision_id uuid not null references public.ai_buyer_pricing_decisions(id) on delete restrict,
  amount numeric(12,2) not null,
  actor text not null check (actor in ('AI','ADMIN','CUSTOMER')),
  status text not null default 'PROPOSED' check (status in ('PROPOSED','ACCEPTED','REJECTED','SUPERSEDED')),
  message_id uuid references public.ai_buyer_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check (amount >= 0)
);

create table if not exists public.ai_buyer_admin_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  task_type text not null default 'PURCHASE_FOLLOWUP',
  status text not null default 'ACTION_REQUIRED' check (status in ('ACTION_REQUIRED','WAITING_CUSTOMER','IN_PROGRESS','COMPLETED','CANCELLED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  assigned_to uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ai_buyer_human_overrides (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  pricing_decision_id uuid references public.ai_buyer_pricing_decisions(id) on delete set null,
  actor_user_id uuid,
  ai_price numeric(12,2),
  admin_price numeric(12,2),
  reason_code text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ai_buyer_cases_conversation_idx on public.ai_buyer_valuation_cases(conversation_id, updated_at desc);
create index if not exists ai_buyer_cases_state_idx on public.ai_buyer_valuation_cases(state, updated_at desc);
create index if not exists ai_buyer_messages_conversation_idx on public.ai_buyer_messages(conversation_id, created_at);
create index if not exists ai_buyer_messages_case_idx on public.ai_buyer_messages(case_id, created_at);
create index if not exists ai_buyer_images_case_idx on public.ai_buyer_case_images(case_id, created_at);
create index if not exists ai_buyer_observations_case_idx on public.ai_buyer_product_observations(case_id, created_at desc);
create index if not exists ai_buyer_price_entries_lookup_idx on public.ai_buyer_price_book_entries(version_id, category, model_code, active);
create index if not exists ai_buyer_pricing_case_idx on public.ai_buyer_pricing_decisions(case_id, created_at desc);
create index if not exists ai_buyer_tasks_status_idx on public.ai_buyer_admin_tasks(status, created_at desc);

drop trigger if exists ai_buyer_customers_touch on public.ai_buyer_customers;
create trigger ai_buyer_customers_touch before update on public.ai_buyer_customers
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_conversations_touch on public.ai_buyer_conversations;
create trigger ai_buyer_conversations_touch before update on public.ai_buyer_conversations
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_cases_touch on public.ai_buyer_valuation_cases;
create trigger ai_buyer_cases_touch before update on public.ai_buyer_valuation_cases
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_webhooks_touch on public.ai_buyer_webhook_events;
create trigger ai_buyer_webhooks_touch before update on public.ai_buyer_webhook_events
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_price_entries_touch on public.ai_buyer_price_book_entries;
create trigger ai_buyer_price_entries_touch before update on public.ai_buyer_price_book_entries
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_tasks_touch on public.ai_buyer_admin_tasks;
create trigger ai_buyer_tasks_touch before update on public.ai_buyer_admin_tasks
for each row execute function public.ai_buyer_touch_updated_at();

alter table public.ai_buyer_customers enable row level security;
alter table public.ai_buyer_conversations enable row level security;
alter table public.ai_buyer_valuation_cases enable row level security;
alter table public.ai_buyer_webhook_events enable row level security;
alter table public.ai_buyer_messages enable row level security;
alter table public.ai_buyer_case_images enable row level security;
alter table public.ai_buyer_product_observations enable row level security;
alter table public.ai_buyer_price_book_versions enable row level security;
alter table public.ai_buyer_price_book_entries enable row level security;
alter table public.ai_buyer_pricing_decisions enable row level security;
alter table public.ai_buyer_offers enable row level security;
alter table public.ai_buyer_admin_tasks enable row level security;
alter table public.ai_buyer_human_overrides enable row level security;

comment on table public.ai_buyer_webhook_events is 'Idempotent LINE webhook inbox. Service-role only in V1.';
comment on table public.ai_buyer_pricing_decisions is 'Auditable pricing snapshot. Conversation AI must never invent a price outside this decision.';
comment on column public.ai_buyer_pricing_decisions.hard_max is 'Server-enforced maximum purchase offer for the case.';

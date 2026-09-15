-- ONE-1 integration storage foundation
-- Durable server-side Inbox/Outbox, cross-system entity mapping and HMAC replay protection.
-- These tables are intentionally not exposed to anon/authenticated browser roles.

create table if not exists public.integration_event_inbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  source text not null,
  event_type text not null,
  version integer not null default 1,
  idempotency_key text not null,
  entity_type text,
  entity_id text,
  entity_sku text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED','PROCESSING','PROCESSED','FAILED','DEAD')),
  attempts integer not null default 0 check (attempts >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (event_id),
  unique (source, idempotency_key)
);

create index if not exists integration_event_inbox_status_received_idx
  on public.integration_event_inbox (status, received_at);
create index if not exists integration_event_inbox_type_received_idx
  on public.integration_event_inbox (event_type, received_at);

create table if not exists public.integration_event_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  destination text not null,
  event_type text not null,
  version integer not null default 1,
  idempotency_key text not null,
  entity_type text,
  entity_id text,
  entity_sku text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','DELIVERED','FAILED','DEAD')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id),
  unique (destination, idempotency_key)
);

create index if not exists integration_event_outbox_retry_idx
  on public.integration_event_outbox (status, next_attempt_at);
create index if not exists integration_event_outbox_destination_status_idx
  on public.integration_event_outbox (destination, status);

create table if not exists public.external_entity_links (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_entity_type text not null,
  source_entity_id text not null,
  target_system text not null,
  target_entity_type text not null,
  target_entity_id text not null,
  business_key text,
  sync_status text not null default 'LINKED' check (sync_status in ('PENDING','LINKED','CONFLICT','ERROR')),
  last_synced_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_entity_type, source_entity_id, target_system, target_entity_type),
  unique (target_system, target_entity_type, target_entity_id, source_system, source_entity_type)
);

create index if not exists external_entity_links_business_key_idx
  on public.external_entity_links (business_key);
create index if not exists external_entity_links_sync_status_idx
  on public.external_entity_links (sync_status);

create table if not exists public.integration_replay_nonces (
  id uuid primary key default gen_random_uuid(),
  key_id text not null,
  nonce text not null,
  source text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (key_id, nonce)
);

create index if not exists integration_replay_nonces_expires_idx
  on public.integration_replay_nonces (expires_at);

alter table public.integration_event_inbox enable row level security;
alter table public.integration_event_outbox enable row level security;
alter table public.external_entity_links enable row level security;
alter table public.integration_replay_nonces enable row level security;

revoke all on table public.integration_event_inbox from anon, authenticated;
revoke all on table public.integration_event_outbox from anon, authenticated;
revoke all on table public.external_entity_links from anon, authenticated;
revoke all on table public.integration_replay_nonces from anon, authenticated;

grant select, insert, update, delete on table public.integration_event_inbox to service_role;
grant select, insert, update, delete on table public.integration_event_outbox to service_role;
grant select, insert, update, delete on table public.external_entity_links to service_role;
grant select, insert, update, delete on table public.integration_replay_nonces to service_role;

comment on table public.integration_event_inbox is 'AMPHON ONE durable inbound integration events. Server-side only.';
comment on table public.integration_event_outbox is 'AMPHON ONE durable outbound integration events and retries. Server-side only.';
comment on table public.external_entity_links is 'Cross-system entity mappings such as System inventory/SKU to Hub product UUID.';
comment on table public.integration_replay_nonces is 'Short-lived HMAC nonces used to reject replayed signed requests.';

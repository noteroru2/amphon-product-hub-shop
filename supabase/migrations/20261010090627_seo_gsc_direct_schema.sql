-- Direct GSC OAuth and site-scoped ingestion. No browser can read Vault tokens.
create table public.commerce_gsc_connections (
  id uuid primary key default gen_random_uuid(),
  connected_by uuid not null references public.profiles(id),
  token_secret_id uuid not null,
  properties jsonb not null,
  state text not null default 'READY' check(state in ('READY','REAUTH','DISCONNECTED')),
  created_at timestamptz not null default now()
);
create table public.commerce_gsc_oauth_states (
  state_hash text primary key,
  actor uuid not null references public.profiles(id),
  verifier text not null,
  expires_at timestamptz not null default now()+interval '10 minutes'
);
create table public.commerce_gsc_sync_jobs (
  site_id text primary key references public.commerce_seo_sites(id),
  connection_id uuid not null references public.commerce_gsc_connections(id),
  property text not null,
  next_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  last_success_at timestamptz,
  last_error text
);
create index commerce_gsc_sync_due_idx on public.commerce_gsc_sync_jobs(next_at);
create index commerce_gsc_sync_connection_idx on public.commerce_gsc_sync_jobs(connection_id);
alter table public.commerce_gsc_connections enable row level security;
alter table public.commerce_gsc_oauth_states enable row level security;
alter table public.commerce_gsc_sync_jobs enable row level security;
create policy gsc_connections_service on public.commerce_gsc_connections to service_role using(true) with check(true);
create policy gsc_states_service on public.commerce_gsc_oauth_states to service_role using(true) with check(true);
create policy gsc_jobs_service on public.commerce_gsc_sync_jobs to service_role using(true) with check(true);
revoke all on public.commerce_gsc_connections,public.commerce_gsc_oauth_states,public.commerce_gsc_sync_jobs from public,anon,authenticated;
grant all on public.commerce_gsc_connections,public.commerce_gsc_oauth_states,public.commerce_gsc_sync_jobs to service_role;
alter table public.commerce_seo_network_snapshots
  add column data_start_date date,
  add column data_end_date date,
  add column last_data_date date,
  add column daily jsonb,
  add column query_truncated boolean;

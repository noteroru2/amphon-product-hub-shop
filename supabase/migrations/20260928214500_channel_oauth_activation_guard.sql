create table if not exists public.sales_channel_oauth_sessions(
 id uuid primary key default gen_random_uuid(), state text not null unique, channel_key text not null, connection_key text not null,
 actor_id uuid not null, redirect_uri text not null, expires_at timestamptz not null default (now()+interval '10 minutes'),
 consumed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.sales_channel_oauth_sessions enable row level security;
revoke all on public.sales_channel_oauth_sessions from anon,authenticated;
grant all on public.sales_channel_oauth_sessions to service_role;
alter table public.sales_channel_connections add column if not exists verified_at timestamptz;
alter table public.sales_channel_connections add column if not exists activation_status text not null default 'LOCKED';
alter table public.sales_channel_connections add column if not exists test_publish_at timestamptz;
alter table public.sales_channel_connections add column if not exists environment text not null default 'TEST';
alter table public.sales_channel_connections drop constraint if exists sales_channel_connections_activation_status_check;
alter table public.sales_channel_connections add constraint sales_channel_connections_activation_status_check check(activation_status in('LOCKED','VERIFIED','TEST_PASSED','ACTIVE'));
create or replace function public.central_channel_read_credentials(p_channel_key text,p_connection_key text)
returns jsonb language sql security definer set search_path='' as $$
 select case when c.credential_secret_id is null then null else (select decrypted_secret::jsonb from vault.decrypted_secrets where id=c.credential_secret_id) end
 from public.sales_channel_connections c where c.channel_key=p_channel_key and c.connection_key=p_connection_key limit 1
$$;
revoke all on function public.central_channel_read_credentials(text,text) from public,anon,authenticated;
grant execute on function public.central_channel_read_credentials(text,text) to service_role;

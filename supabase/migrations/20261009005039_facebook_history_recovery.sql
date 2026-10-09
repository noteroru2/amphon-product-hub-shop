create table public.facebook_history_recovery (
 connection_key text primary key,
 after_cursor text,
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 last_error text
);
alter table public.facebook_history_recovery enable row level security;
revoke all on public.facebook_history_recovery from public,anon,authenticated;
grant all on public.facebook_history_recovery to service_role;
insert into public.facebook_history_recovery(connection_key)
select connection_key from public.sales_channel_connections where channel_key='facebook_page' and activation_status='ACTIVE' and environment='PRODUCTION';

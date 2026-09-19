-- AMPHON Channel Architecture foundation
-- Product Hub orchestrates channels; AMPHON System remains canonical stock authority.

create table if not exists public.sales_channel_registry (
  channel_key text primary key
    check (channel_key in ('website','facebook_page','facebook_marketplace','shopee')),
  label text not null,
  adapter_mode text not null
    check (adapter_mode in ('native','assisted','direct_api','partner_api','disabled')),
  enabled boolean not null default true,
  auto_publish boolean not null default false,
  projects_stock boolean not null default false,
  requires_external_auth boolean not null default false,
  capabilities jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.sales_channel_registry
  (channel_key,label,adapter_mode,enabled,auto_publish,projects_stock,requires_external_auth,capabilities)
values
  ('website','AMPHON SHOP','native',true,true,true,false,
   '["publish","update_content","update_price","project_stock","end_listing","orders"]'::jsonb),
  ('facebook_page','Facebook Page','assisted',true,false,false,false,
   '["publish","update_content","update_price","end_listing"]'::jsonb),
  ('facebook_marketplace','Facebook Marketplace','assisted',true,false,false,false,
   '["publish","update_content","update_price","end_listing"]'::jsonb),
  ('shopee','Shopee','disabled',false,false,true,true,'[]'::jsonb)
on conflict (channel_key) do nothing;

-- Direct Shopee API is currently not available to this seller account.
-- Keep the already-installed Shopee runtime fail-closed and prevent queue growth.
do $
begin
  if to_regclass('public.shopee_settings') is not null then
    update public.shopee_settings
       set auto_publish_enabled = false,
           updated_at = now()
     where id = 1;
  end if;
end $;

create or replace function public.touch_sales_channel_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_channel_registry_touch on public.sales_channel_registry;
create trigger sales_channel_registry_touch
before update on public.sales_channel_registry
for each row execute procedure public.touch_sales_channel_row();

create table if not exists public.sales_channel_links (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  channel_key text not null references public.sales_channel_registry(channel_key),
  connection_key text not null default 'default',
  external_listing_id text,
  external_url text,
  status text not null default 'NOT_PUBLISHED'
    check (status in ('NOT_PUBLISHED','PENDING','PUBLISHED','ENDED','ERROR')),
  adapter_mode text not null
    check (adapter_mode in ('native','assisted','direct_api','partner_api','disabled')),
  price_snapshot numeric(12,2),
  stock_snapshot integer check (stock_snapshot is null or stock_snapshot >= 0),
  metadata jsonb not null default '{}'::jsonb,
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, channel_key, connection_key)
);

create index if not exists sales_channel_links_channel_status_idx
  on public.sales_channel_links(channel_key,status,updated_at desc);

drop trigger if exists sales_channel_links_touch on public.sales_channel_links;
create trigger sales_channel_links_touch
before update on public.sales_channel_links
for each row execute procedure public.touch_sales_channel_row();

create table if not exists public.sales_channel_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  channel_key text not null references public.sales_channel_registry(channel_key),
  connection_key text not null default 'default',
  action text not null check (action in ('PUBLISH','UPDATE','STOCK_SYNC','END')),
  dedupe_key text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','DONE','FAILED','CANCELLED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_channel_jobs_claim_idx
  on public.sales_channel_jobs(status,run_after,channel_key);

drop trigger if exists sales_channel_jobs_touch on public.sales_channel_jobs;
create trigger sales_channel_jobs_touch
before update on public.sales_channel_jobs
for each row execute procedure public.touch_sales_channel_row();

-- Canonical one-of-one stock projection. This function never writes stock.
create or replace function public.sales_channel_projected_stock(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.one_availability = 'IN_STOCK' then 1 else 0 end
    from public.products p
   where p.id = p_product_id;
$$;

revoke all on function public.sales_channel_projected_stock(uuid) from public, anon, authenticated;
grant execute on function public.sales_channel_projected_stock(uuid) to service_role;

alter table public.sales_channel_registry enable row level security;
alter table public.sales_channel_links enable row level security;
alter table public.sales_channel_jobs enable row level security;

drop policy if exists sales_channel_registry_read on public.sales_channel_registry;
create policy sales_channel_registry_read on public.sales_channel_registry
for select to authenticated using (public.current_user_active());

drop policy if exists sales_channel_links_read on public.sales_channel_links;
create policy sales_channel_links_read on public.sales_channel_links
for select to authenticated using (public.current_user_active());

drop policy if exists sales_channel_jobs_read_admin on public.sales_channel_jobs;
create policy sales_channel_jobs_read_admin on public.sales_channel_jobs
for select to authenticated using (public.current_user_role() in ('owner','admin'));

revoke insert, update, delete on table public.sales_channel_registry from anon, authenticated;
revoke insert, update, delete on table public.sales_channel_links from anon, authenticated;
revoke insert, update, delete on table public.sales_channel_jobs from anon, authenticated;

grant select, insert, update, delete on table public.sales_channel_registry to service_role;
grant select, insert, update, delete on table public.sales_channel_links to service_role;
grant select, insert, update, delete on table public.sales_channel_jobs to service_role;

comment on table public.sales_channel_registry is
  'Stable AMPHON channel registry. Adapter mode may change without changing Product Master.';
comment on table public.sales_channel_links is
  'Generic external listing identity layer for channel adapters. Existing channel-specific runtimes may coexist during migration.';
comment on table public.sales_channel_jobs is
  'Generic durable adapter queue. Service-role only; external channels never own canonical stock.';

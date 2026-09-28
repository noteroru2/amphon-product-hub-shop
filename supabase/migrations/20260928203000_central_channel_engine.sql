-- Central Channel Engine v1
-- AMPHON System remains canonical stock authority. External channels are projections only.

alter table public.sales_channel_registry drop constraint if exists sales_channel_registry_channel_key_check;
alter table public.sales_channel_registry add constraint sales_channel_registry_channel_key_check
  check (channel_key in ('website','facebook_page','facebook_marketplace','lazada','tiktok_shop','shopee'));

insert into public.sales_channel_registry
(channel_key,label,adapter_mode,enabled,auto_publish,projects_stock,requires_external_auth,capabilities,config)
values
('lazada','Lazada','direct_api',true,false,true,true,'["publish","update_content","update_price","project_stock","end_listing","orders","webhooks"]','{"activation":"credentials_required"}'),
('tiktok_shop','TikTok Shop','partner_api',true,false,true,true,'["publish","update_content","update_price","project_stock","end_listing","orders","webhooks"]','{"activation":"authorization_required"}')
on conflict (channel_key) do update set
 label=excluded.label, adapter_mode=excluded.adapter_mode, projects_stock=excluded.projects_stock,
 requires_external_auth=excluded.requires_external_auth, capabilities=excluded.capabilities, config=excluded.config, updated_at=now();

update public.sales_channel_registry set adapter_mode='direct_api', requires_external_auth=true,
 capabilities='["publish","update_content","update_price","end_listing"]'::jsonb,
 config=jsonb_build_object('connection_model','multi_page','activation','page_tokens_required'), updated_at=now()
where channel_key='facebook_page';

update public.sales_channel_registry set enabled=false, auto_publish=false, adapter_mode='disabled',
 capabilities='[]'::jsonb, config=jsonb_build_object('activation','waiting_for_api_access'), updated_at=now()
where channel_key='shopee';

alter table public.sales_channel_jobs drop constraint if exists sales_channel_jobs_action_check;
alter table public.sales_channel_jobs add constraint sales_channel_jobs_action_check
  check (action in ('PUBLISH','UPDATE','PRICE_SYNC','STOCK_SYNC','END','ORDER_PULL','ORDER_ACK'));

alter table public.sales_channel_jobs drop constraint if exists sales_channel_jobs_status_check;
alter table public.sales_channel_jobs add constraint sales_channel_jobs_status_check
  check (status in ('PENDING','PROCESSING','DONE','FAILED','DEAD','CANCELLED'));

alter table public.sales_channel_jobs add column if not exists max_attempts integer not null default 12 check(max_attempts between 1 and 100);
alter table public.sales_channel_jobs add column if not exists completed_at timestamptz;
alter table public.sales_channel_jobs add column if not exists result jsonb;

create table if not exists public.sales_channel_connections (
 id uuid primary key default gen_random_uuid(),
 channel_key text not null references public.sales_channel_registry(channel_key),
 connection_key text not null,
 label text not null,
 external_account_id text,
 status text not null default 'DISCONNECTED' check(status in ('DISCONNECTED','CONNECTED','EXPIRED','REVOKED','ERROR','WAITING_ACCESS')),
 secret_ref jsonb not null default '{}'::jsonb,
 config jsonb not null default '{}'::jsonb,
 last_error text,
 last_synced_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(channel_key,connection_key)
);
create index if not exists sales_channel_connections_status_idx on public.sales_channel_connections(channel_key,status);

insert into public.sales_channel_connections(channel_key,connection_key,label,status,config)
values
 ('lazada','default','Lazada Thailand','DISCONNECTED','{"activation":"credentials_required"}'),
 ('tiktok_shop','default','TikTok Shop Thailand','DISCONNECTED','{"activation":"authorization_required"}'),
 ('facebook_page','page_1','Facebook Page 1','DISCONNECTED','{}'),
 ('facebook_page','page_2','Facebook Page 2','DISCONNECTED','{}'),
 ('facebook_page','page_3','Facebook Page 3','DISCONNECTED','{}'),
 ('shopee','default','Shopee Thailand','WAITING_ACCESS','{"activation":"waiting_for_api_access"}')
on conflict(channel_key,connection_key) do nothing;

create table if not exists public.sales_channel_webhook_events (
 id uuid primary key default gen_random_uuid(),
 channel_key text not null references public.sales_channel_registry(channel_key),
 connection_key text not null default 'default',
 event_key text not null,
 event_type text,
 payload jsonb not null,
 status text not null default 'RECEIVED' check(status in ('RECEIVED','PROCESSING','PROCESSED','IGNORED','FAILED')),
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 last_error text,
 unique(channel_key,connection_key,event_key)
);

create table if not exists public.sales_channel_orders (
 id uuid primary key default gen_random_uuid(),
 channel_key text not null references public.sales_channel_registry(channel_key),
 connection_key text not null default 'default',
 external_order_id text not null,
 external_status text,
 normalized_status text not null default 'RECEIVED' check(normalized_status in ('RECEIVED','RESERVED','PAID','FULFILLING','SHIPPED','COMPLETED','CANCELLED','REFUNDED','ERROR')),
 payload jsonb not null default '{}'::jsonb,
 received_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(channel_key,connection_key,external_order_id)
);

create table if not exists public.sales_channel_order_items (
 id uuid primary key default gen_random_uuid(),
 channel_order_id uuid not null references public.sales_channel_orders(id) on delete cascade,
 product_id uuid references public.products(id) on delete restrict,
 external_item_id text,
 seller_sku text,
 quantity integer not null default 1 check(quantity > 0),
 unit_price numeric(12,2),
 unique(channel_order_id,external_item_id)
);

create table if not exists public.sales_channel_inventory_locks (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 owner_type text not null check(owner_type in ('CHANNEL_ORDER','HUB_ORDER','MANUAL')),
 owner_key text not null,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists sales_channel_one_active_inventory_lock
 on public.sales_channel_inventory_locks(product_id) where status='ACTIVE';

create or replace function public.central_channel_reserve_inventory(p_product_id uuid,p_owner_type text,p_owner_key text,p_ttl_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_available text; v_lock uuid;
begin
 select one_availability into v_available from public.products where id=p_product_id for update;
 if not found then return jsonb_build_object('ok',false,'error','PRODUCT_NOT_FOUND'); end if;
 if v_available <> 'IN_STOCK' then return jsonb_build_object('ok',false,'error','OUT_OF_STOCK'); end if;
 update public.sales_channel_inventory_locks set status='EXPIRED',updated_at=now()
  where product_id=p_product_id and status='ACTIVE' and expires_at is not null and expires_at<=now();
 begin
  insert into public.sales_channel_inventory_locks(product_id,owner_type,owner_key,expires_at)
  values(p_product_id,p_owner_type,p_owner_key,case when p_ttl_minutes>0 then now()+make_interval(mins=>least(p_ttl_minutes,1440)) else null end)
  returning id into v_lock;
 exception when unique_violation then return jsonb_build_object('ok',false,'error','INVENTORY_LOCKED');
 end;
 return jsonb_build_object('ok',true,'lock_id',v_lock);
end $$;

create or replace function public.central_channel_release_inventory(p_owner_type text,p_owner_key text)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.sales_channel_inventory_locks set status='RELEASED',updated_at=now()
 where owner_type=p_owner_type and owner_key=p_owner_key and status='ACTIVE';
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.central_channel_claim_jobs(p_worker_id text,p_limit integer default 10,p_lock_timeout_seconds integer default 120)
returns setof public.sales_channel_jobs language plpgsql security definer set search_path='' as $$
begin
 return query with c as (
  select j.id from public.sales_channel_jobs j
  join public.sales_channel_registry r on r.channel_key=j.channel_key
  where r.enabled=true and r.adapter_mode<>'disabled'
   and ((j.status in ('PENDING','FAILED') and j.run_after<=now() and j.attempt_count<j.max_attempts)
    or (j.status='PROCESSING' and j.locked_at<now()-make_interval(secs=>greatest(30,least(p_lock_timeout_seconds,900)))))
  order by j.run_after,j.created_at for update of j skip locked limit greatest(1,least(p_limit,50))
 )
 update public.sales_channel_jobs j set status='PROCESSING',attempt_count=j.attempt_count+1,locked_at=now(),locked_by=p_worker_id,last_error=null,updated_at=now()
 from c where j.id=c.id returning j.*;
end $$;

alter table public.sales_channel_connections enable row level security;
alter table public.sales_channel_webhook_events enable row level security;
alter table public.sales_channel_orders enable row level security;
alter table public.sales_channel_order_items enable row level security;
alter table public.sales_channel_inventory_locks enable row level security;

create policy sales_channel_connections_admin_read on public.sales_channel_connections for select to authenticated using(public.current_user_role() in ('owner','admin'));
create policy sales_channel_orders_staff_read on public.sales_channel_orders for select to authenticated using(public.current_user_active());
create policy sales_channel_order_items_staff_read on public.sales_channel_order_items for select to authenticated using(public.current_user_active());
create policy sales_channel_locks_admin_read on public.sales_channel_inventory_locks for select to authenticated using(public.current_user_role() in ('owner','admin'));

revoke insert,update,delete on public.sales_channel_connections,public.sales_channel_webhook_events,public.sales_channel_orders,public.sales_channel_order_items,public.sales_channel_inventory_locks from anon,authenticated;
grant select,insert,update,delete on public.sales_channel_connections,public.sales_channel_webhook_events,public.sales_channel_orders,public.sales_channel_order_items,public.sales_channel_inventory_locks to service_role;
revoke all on function public.central_channel_reserve_inventory(uuid,text,text,integer), public.central_channel_release_inventory(text,text), public.central_channel_claim_jobs(text,integer,integer) from public,anon,authenticated;
grant execute on function public.central_channel_reserve_inventory(uuid,text,text,integer), public.central_channel_release_inventory(text,text), public.central_channel_claim_jobs(text,integer,integer) to service_role;

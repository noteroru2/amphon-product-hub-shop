-- AMPHON ONE / Shopee seller-channel runtime foundation.
-- Shopee is a projection only. AMPHON System remains stock / availability authority.

create table if not exists public.shopee_settings (
  id smallint primary key default 1 check (id = 1),
  auto_publish_enabled boolean not null default true,
  publish_delay_seconds integer not null default 60
    check (publish_delay_seconds between 0 and 3600),
  price_markup_percent numeric(8,3) not null default 0
    check (price_markup_percent between 0 and 100),
  default_condition text not null default 'USED'
    check (default_condition in ('USED','NEW')),
  updated_at timestamptz not null default now()
);

insert into public.shopee_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.shopee_connections (
  id uuid primary key default gen_random_uuid(),
  shop_id bigint not null unique,
  merchant_id bigint,
  region text not null default 'TH',
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED','EXPIRED','REVOKED','ERROR')),
  access_secret_id uuid not null,
  refresh_secret_id uuid not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  authorization_expires_at timestamptz,
  last_refresh_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shopee_auth_states (
  state_hash text primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.shopee_category_mappings (
  id uuid primary key default gen_random_uuid(),
  source_category text not null,
  source_subtype text,
  shopee_category_id bigint not null,
  shopee_category_name text,
  attribute_list jsonb not null default '[]'::jsonb,
  logistic_info jsonb not null default '[]'::jsonb,
  weight_kg numeric(10,3),
  dimension jsonb,
  brand jsonb,
  active boolean not null default true,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shopee_category_mapping_unique
on public.shopee_category_mappings(source_category, coalesce(source_subtype,''))
where active;

create table if not exists public.shopee_product_mappings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id bigint not null references public.shopee_connections(shop_id) on delete cascade,
  shopee_item_id bigint,
  seller_sku text not null,
  shopee_category_id bigint,
  published_title text,
  published_price numeric(12,2),
  projection_stock integer not null default 0,
  image_ids jsonb not null default '[]'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING','PUBLISHED','FAILED','ENDED')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id, product_id),
  unique(shop_id, shopee_item_id)
);

create table if not exists public.shopee_publish_queue (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  shop_id bigint not null references public.shopee_connections(shop_id) on delete cascade,
  action text not null check (action in ('CREATE','UPDATE','STOCK_SYNC','END')),
  status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','DONE','FAILED','CANCELLED')),
  publish_after timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  response jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists shopee_publish_queue_active_unique
on public.shopee_publish_queue(shop_id, product_id, action)
where status in ('PENDING','PROCESSING');

create index if not exists shopee_publish_queue_due_idx
on public.shopee_publish_queue(status, publish_after)
where status = 'PENDING';

create table if not exists public.shopee_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  shop_id bigint,
  code integer,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.shopee_settings enable row level security;
alter table public.shopee_connections enable row level security;
alter table public.shopee_auth_states enable row level security;
alter table public.shopee_category_mappings enable row level security;
alter table public.shopee_product_mappings enable row level security;
alter table public.shopee_publish_queue enable row level security;
alter table public.shopee_webhook_events enable row level security;

revoke all on public.shopee_connections from anon, authenticated;
revoke all on public.shopee_auth_states from anon, authenticated;
revoke all on public.shopee_webhook_events from anon, authenticated;
revoke insert, update, delete on public.shopee_product_mappings from anon, authenticated;
revoke insert, update, delete on public.shopee_publish_queue from anon, authenticated;

grant select on public.shopee_settings to authenticated;
grant select, insert, update, delete on public.shopee_category_mappings to authenticated;
grant select on public.shopee_product_mappings to authenticated;
grant select on public.shopee_publish_queue to authenticated;
grant all on public.shopee_connections to service_role;
grant all on public.shopee_auth_states to service_role;
grant all on public.shopee_category_mappings to service_role;
grant all on public.shopee_product_mappings to service_role;
grant all on public.shopee_publish_queue to service_role;
grant all on public.shopee_webhook_events to service_role;

drop policy if exists shopee_settings_staff_read on public.shopee_settings;
create policy shopee_settings_staff_read on public.shopee_settings
for select to authenticated
using (public.current_user_active());

drop policy if exists shopee_category_staff_read on public.shopee_category_mappings;
create policy shopee_category_staff_read on public.shopee_category_mappings
for select to authenticated
using (public.current_user_active());

drop policy if exists shopee_category_admin_write on public.shopee_category_mappings;
create policy shopee_category_admin_write on public.shopee_category_mappings
for all to authenticated
using (public.current_user_role() in ('owner','admin'))
with check (public.current_user_role() in ('owner','admin'));

drop policy if exists shopee_product_staff_read on public.shopee_product_mappings;
create policy shopee_product_staff_read on public.shopee_product_mappings
for select to authenticated
using (public.current_user_active());

drop policy if exists shopee_queue_staff_read on public.shopee_publish_queue;
create policy shopee_queue_staff_read on public.shopee_publish_queue
for select to authenticated
using (public.current_user_active());

create or replace view public.shopee_connection_status_v
with (security_invoker = true)
as
select
  id,
  shop_id,
  merchant_id,
  region,
  status,
  access_expires_at,
  refresh_expires_at,
  authorization_expires_at,
  last_refresh_at,
  last_error,
  created_at,
  updated_at
from public.shopee_connections;

grant select on public.shopee_connection_status_v to authenticated;

drop policy if exists shopee_connections_staff_status_read on public.shopee_connections;
create policy shopee_connections_staff_status_read on public.shopee_connections
for select to authenticated using (false);

create or replace function public.shopee_create_auth_state(
  p_state text,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.shopee_auth_states
   where expires_at < now() or consumed_at is not null;

  insert into public.shopee_auth_states(state_hash, actor_id, expires_at)
  values (
    encode(extensions.digest(p_state,'sha256'),'hex'),
    p_actor_id,
    now() + interval '10 minutes'
  )
  on conflict (state_hash) do update
    set actor_id=excluded.actor_id,
        expires_at=excluded.expires_at,
        consumed_at=null,
        created_at=now();

  return true;
end;
$$;

revoke all on function public.shopee_create_auth_state(text,uuid)
  from public, anon, authenticated;
grant execute on function public.shopee_create_auth_state(text,uuid)
  to service_role;

create or replace function public.shopee_consume_auth_state(p_state text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
begin
  update public.shopee_auth_states
     set consumed_at = now()
   where state_hash = encode(extensions.digest(p_state,'sha256'),'hex')
     and consumed_at is null
     and expires_at > now()
  returning actor_id into v_actor;

  if not found then
    raise exception 'SHOPEE_AUTH_STATE_INVALID';
  end if;

  return v_actor;
end;
$$;

revoke all on function public.shopee_consume_auth_state(text)
  from public, anon, authenticated;
grant execute on function public.shopee_consume_auth_state(text)
  to service_role;

create or replace function public.shopee_store_tokens(
  p_shop_id bigint,
  p_merchant_id bigint,
  p_access_token text,
  p_refresh_token text,
  p_access_expires_at timestamptz,
  p_refresh_expires_at timestamptz,
  p_authorization_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.shopee_connections%rowtype;
  v_access_secret uuid;
  v_refresh_secret uuid;
  v_id uuid;
begin
  if p_shop_id is null
     or coalesce(p_access_token,'')=''
     or coalesce(p_refresh_token,'')=''
  then
    raise exception 'SHOPEE_TOKEN_INVALID';
  end if;

  select * into v_row
    from public.shopee_connections
   where shop_id=p_shop_id
   for update;

  if v_row.id is null then
    select vault.create_secret(
      p_access_token,
      'shopee_access_' || p_shop_id::text,
      'Shopee access token for AMPHON shop ' || p_shop_id::text
    ) into v_access_secret;

    select vault.create_secret(
      p_refresh_token,
      'shopee_refresh_' || p_shop_id::text,
      'Shopee refresh token for AMPHON shop ' || p_shop_id::text
    ) into v_refresh_secret;

    insert into public.shopee_connections(
      shop_id,
      merchant_id,
      status,
      access_secret_id,
      refresh_secret_id,
      access_expires_at,
      refresh_expires_at,
      authorization_expires_at,
      last_refresh_at
    )
    values (
      p_shop_id,
      p_merchant_id,
      'CONNECTED',
      v_access_secret,
      v_refresh_secret,
      p_access_expires_at,
      p_refresh_expires_at,
      p_authorization_expires_at,
      now()
    )
    returning id into v_id;
  else
    perform vault.update_secret(v_row.access_secret_id, p_access_token);
    perform vault.update_secret(v_row.refresh_secret_id, p_refresh_token);

    update public.shopee_connections
       set merchant_id = coalesce(p_merchant_id, merchant_id),
           status='CONNECTED',
           access_expires_at=p_access_expires_at,
           refresh_expires_at=p_refresh_expires_at,
           authorization_expires_at=coalesce(
             p_authorization_expires_at,
             authorization_expires_at
           ),
           last_refresh_at=now(),
           last_error=null,
           updated_at=now()
     where id=v_row.id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.shopee_store_tokens(
  bigint,bigint,text,text,timestamptz,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.shopee_store_tokens(
  bigint,bigint,text,text,timestamptz,timestamptz,timestamptz
) to service_role;

create or replace function public.shopee_get_connection_secret(p_shop_id bigint)
returns table(
  shop_id bigint,
  merchant_id bigint,
  status text,
  access_token text,
  refresh_token text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  authorization_expires_at timestamptz
)
language sql
security definer
set search_path=''
as $$
  select
    c.shop_id,
    c.merchant_id,
    c.status,
    a.decrypted_secret,
    r.decrypted_secret,
    c.access_expires_at,
    c.refresh_expires_at,
    c.authorization_expires_at
  from public.shopee_connections c
  join vault.decrypted_secrets a on a.id=c.access_secret_id
  join vault.decrypted_secrets r on r.id=c.refresh_secret_id
  where c.shop_id=p_shop_id
  limit 1;
$$;

revoke all on function public.shopee_get_connection_secret(bigint)
  from public, anon, authenticated;
grant execute on function public.shopee_get_connection_secret(bigint)
  to service_role;

create or replace function private.shopee_mapping_for_product(
  target_product_id uuid
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select m.id
  from public.products p
  join public.shopee_category_mappings m
    on m.source_category=p.category
   and (m.source_subtype=p.subtype or m.source_subtype is null)
   and m.active
  where p.id=target_product_id
  order by (m.source_subtype is not null) desc, m.updated_at desc
  limit 1;
$$;

revoke all on function private.shopee_mapping_for_product(uuid)
  from public, anon, authenticated;

create or replace function private.shopee_product_is_eligible(
  target_product_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.products p
    where p.id=target_product_id
      and p.status='published'
      and p.price > 0
      and p.one_availability is distinct from 'SOLD'
      and exists (
        select 1
        from public.product_publications pp
        where pp.product_id=p.id
          and pp.channel='website'
          and pp.status='published'
      )
      and (
        select count(*)
        from public.product_images pi
        where pi.product_id=p.id
          and pi.public_url is not null
      ) >= 2
      and exists (
        select 1
        from public.product_images pi
        where pi.product_id=p.id
          and pi.public_url is not null
          and pi.is_cover
      )
      and private.shopee_mapping_for_product(p.id) is not null
  );
$$;

revoke all on function private.shopee_product_is_eligible(uuid)
  from public, anon, authenticated;

create or replace function private.enqueue_shopee_action(
  p_product_id uuid,
  p_shop_id bigint,
  p_action text,
  p_delay_seconds integer default 0
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_action not in ('CREATE','UPDATE','STOCK_SYNC','END') then
    raise exception 'SHOPEE_ACTION_INVALID';
  end if;

  insert into public.shopee_publish_queue(
    product_id,
    shop_id,
    action,
    status,
    publish_after
  )
  values(
    p_product_id,
    p_shop_id,
    p_action,
    'PENDING',
    now()+make_interval(secs=>greatest(0,coalesce(p_delay_seconds,0)))
  )
  on conflict do nothing;

  return found;
end;
$$;

revoke all on function private.enqueue_shopee_action(
  uuid,bigint,text,integer
) from public, anon, authenticated;

create or replace function public.seed_shopee_publish_queue(p_shop_id bigint)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_delay integer := 60;
  v_count integer := 0;
  v_product record;
begin
  if not exists(
    select 1
    from public.shopee_connections c
    where c.shop_id=p_shop_id
      and c.status='CONNECTED'
  ) then
    raise exception 'SHOPEE_CONNECTION_REQUIRED';
  end if;

  select publish_delay_seconds
    into v_delay
    from public.shopee_settings
   where id=1;

  for v_product in
    select p.id
    from public.products p
    where private.shopee_product_is_eligible(p.id)
      and not exists (
        select 1
        from public.shopee_product_mappings m
        where m.product_id=p.id
          and m.shop_id=p_shop_id
          and m.status='PUBLISHED'
      )
  loop
    if private.enqueue_shopee_action(
      v_product.id,
      p_shop_id,
      'CREATE',
      v_delay
    ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.seed_shopee_publish_queue(bigint)
  from public, anon, authenticated;
grant execute on function public.seed_shopee_publish_queue(bigint)
  to service_role;

create or replace function private.shopee_enqueue_from_website_publication()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_auto boolean := true;
  v_delay integer := 60;
  v_conn record;
begin
  if new.channel <> 'website' then
    return new;
  end if;

  select auto_publish_enabled, publish_delay_seconds
    into v_auto, v_delay
    from public.shopee_settings
   where id=1;

  if new.status='published'
     and coalesce(v_auto,true)
     and private.shopee_product_is_eligible(new.product_id)
  then
    for v_conn in
      select shop_id
      from public.shopee_connections
      where status='CONNECTED'
    loop
      perform private.enqueue_shopee_action(
        new.product_id,
        v_conn.shop_id,
        'CREATE',
        v_delay
      );
    end loop;
  elsif new.status <> 'published' then
    for v_conn in
      select shop_id
      from public.shopee_product_mappings
      where product_id=new.product_id
        and status='PUBLISHED'
    loop
      perform private.enqueue_shopee_action(
        new.product_id,
        v_conn.shop_id,
        'STOCK_SYNC',
        0
      );
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function private.shopee_enqueue_from_website_publication()
  from public, anon, authenticated;

drop trigger if exists trg_shopee_enqueue_website
  on public.product_publications;

create trigger trg_shopee_enqueue_website
after insert or update of channel,status
on public.product_publications
for each row
execute procedure private.shopee_enqueue_from_website_publication();

create or replace function private.shopee_enqueue_stock_projection()
returns trigger
language plpgsql
security definer
set search_path=''
as $
declare
  v_map record;
  v_conn record;
  v_auto boolean := true;
  v_delay integer := 60;
begin
  if new.status is not distinct from old.status
     and new.one_availability is not distinct from old.one_availability
  then
    return new;
  end if;

  -- Publication and product-status updates may commit in either order.
  -- Re-check CREATE eligibility here as well as on Website publication so
  -- whichever write happens second closes the gate. The queue unique index
  -- makes the operation idempotent.
  select auto_publish_enabled, publish_delay_seconds
    into v_auto, v_delay
    from public.shopee_settings
   where id=1;

  if new.status='published'
     and coalesce(v_auto,true)
     and private.shopee_product_is_eligible(new.id)
  then
    for v_conn in
      select shop_id
      from public.shopee_connections
      where status='CONNECTED'
    loop
      perform private.enqueue_shopee_action(
        new.id,
        v_conn.shop_id,
        'CREATE',
        v_delay
      );
    end loop;
  end if;

  -- Existing external listings always follow AMPHON System's availability.
  for v_map in
    select shop_id
    from public.shopee_product_mappings
    where product_id=new.id
      and status='PUBLISHED'
  loop
    perform private.enqueue_shopee_action(
      new.id,
      v_map.shop_id,
      'STOCK_SYNC',
      0
    );
  end loop;

  return new;
end;
$;

revoke all on function private.shopee_enqueue_stock_projection()
  from public, anon, authenticated;

drop trigger if exists trg_shopee_stock_projection
  on public.products;

create trigger trg_shopee_stock_projection
after update of status,one_availability
on public.products
for each row
execute procedure private.shopee_enqueue_stock_projection();

create or replace function public.claim_shopee_publish_queue(
  p_worker_id text,
  p_limit integer default 5
)
returns table(
  id uuid,
  product_id uuid,
  shop_id bigint,
  action text,
  attempt_count integer
)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query
  with due as (
    select q.id
    from public.shopee_publish_queue q
    where (
      q.status='PENDING'
      and q.publish_after <= now()
    ) or (
      q.status='PROCESSING'
      and q.locked_at < now()-interval '10 minutes'
    )
    order by q.publish_after, q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),20))
  ),
  claimed as (
    update public.shopee_publish_queue q
       set status='PROCESSING',
           attempt_count=q.attempt_count+1,
           locked_at=now(),
           locked_by=left(coalesce(p_worker_id,'worker'),120),
           updated_at=now()
      from due
     where q.id=due.id
    returning
      q.id,
      q.product_id,
      q.shop_id,
      q.action,
      q.attempt_count
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_shopee_publish_queue(text,integer)
  from public, anon, authenticated;
grant execute on function public.claim_shopee_publish_queue(text,integer)
  to service_role;

create or replace function public.complete_shopee_publish_queue(
  p_queue_id uuid,
  p_worker_id text,
  p_response jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.shopee_publish_queue
     set status='DONE',
         response=coalesce(p_response,'{}'::jsonb),
         completed_at=now(),
         locked_at=null,
         locked_by=null,
         last_error=null,
         updated_at=now()
   where id=p_queue_id
     and status='PROCESSING'
     and locked_by=left(coalesce(p_worker_id,'worker'),120);

  return found;
end;
$$;

revoke all on function public.complete_shopee_publish_queue(
  uuid,text,jsonb
) from public, anon, authenticated;
grant execute on function public.complete_shopee_publish_queue(
  uuid,text,jsonb
) to service_role;

create or replace function public.fail_shopee_publish_queue(
  p_queue_id uuid,
  p_worker_id text,
  p_error text,
  p_retryable boolean default true
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_attempt integer;
  v_status text;
  v_delay interval;
begin
  select attempt_count
    into v_attempt
    from public.shopee_publish_queue
   where id=p_queue_id
     and status='PROCESSING'
     and locked_by=left(coalesce(p_worker_id,'worker'),120)
   for update;

  if v_attempt is null then
    return 'IGNORED';
  end if;

  if not p_retryable or v_attempt >= 5 then
    v_status := 'FAILED';

    update public.shopee_publish_queue
       set status='FAILED',
           last_error=left(coalesce(p_error,'SHOPEE_FAILED'),1500),
           locked_at=null,
           locked_by=null,
           updated_at=now()
     where id=p_queue_id;
  else
    v_status := 'PENDING';
    v_delay := case v_attempt
      when 1 then interval '1 minute'
      when 2 then interval '5 minutes'
      when 3 then interval '15 minutes'
      else interval '30 minutes'
    end;

    update public.shopee_publish_queue
       set status='PENDING',
           publish_after=now()+v_delay,
           last_error=left(coalesce(p_error,'SHOPEE_FAILED'),1500),
           locked_at=null,
           locked_by=null,
           updated_at=now()
     where id=p_queue_id;
  end if;

  return v_status;
end;
$$;

revoke all on function public.fail_shopee_publish_queue(
  uuid,text,text,boolean
) from public, anon, authenticated;
grant execute on function public.fail_shopee_publish_queue(
  uuid,text,text,boolean
) to service_role;

comment on table public.shopee_product_mappings is
  'Shopee is a channel projection. AMPHON System remains stock/availability authority.';

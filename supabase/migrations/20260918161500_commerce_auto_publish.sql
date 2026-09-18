-- AMPHON SHOP / Hub — automatic Website publication after readiness stabilization.
-- Uses the existing ONE-2C readiness contract and never mutates ONE availability.
-- Default: enabled, 180-second stabilization window.

alter table public.commerce_store_settings
  add column if not exists auto_publish_enabled boolean not null default true,
  add column if not exists auto_publish_delay_seconds integer not null default 180;

do $$
begin
  alter table public.commerce_store_settings
    add constraint commerce_store_settings_auto_publish_delay_check
    check (auto_publish_delay_seconds between 60 and 3600);
exception when duplicate_object then null;
end $$;

create table if not exists public.commerce_auto_publish_queue (
  product_id uuid primary key references public.products(id) on delete cascade,
  eligible_at timestamptz not null default now(),
  publish_after timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','published','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.commerce_auto_publish_queue is
  'Server-side AMPHON SHOP auto-publish queue. Product readiness remains owned by Hub/ONE-2C; inventory availability remains owned by AMPHON System.';

create index if not exists commerce_auto_publish_due_idx
  on public.commerce_auto_publish_queue(status, publish_after)
  where status = 'pending';

alter table public.commerce_auto_publish_queue enable row level security;
revoke all on table public.commerce_auto_publish_queue from anon;
revoke insert, update, delete on table public.commerce_auto_publish_queue from authenticated;
grant select on table public.commerce_auto_publish_queue to authenticated;
grant select, insert, update, delete on table public.commerce_auto_publish_queue to service_role;

drop policy if exists commerce_auto_publish_queue_staff_read on public.commerce_auto_publish_queue;
create policy commerce_auto_publish_queue_staff_read
on public.commerce_auto_publish_queue
for select to authenticated
using (public.current_user_active());

create or replace function private.commerce_auto_publish_is_eligible(target_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_image_count integer := 0;
  v_has_cover boolean := false;
  v_specs_complete boolean := false;
  v_content_complete boolean := false;
begin
  select * into p from public.products where id = target_product_id;
  if p.id is null or p.status <> 'ready_to_list' then return false; end if;

  if coalesce(btrim(p.sku), '') = ''
     or coalesce(btrim(p.title), '') = ''
     or coalesce(p.price, 0) <= 0 then
    return false;
  end if;

  select count(*)::integer, coalesce(bool_or(is_cover and public_url is not null), false)
    into v_image_count, v_has_cover
    from public.product_images
   where product_id = target_product_id
     and public_url is not null;

  if v_image_count < 2 or not v_has_cover then return false; end if;

  if coalesce(p.one_managed, false) then
    return coalesce(p.one_photos_complete, false)
      and coalesce(p.one_specs_complete, false)
      and coalesce(p.one_listing_content_complete, false);
  end if;

  -- Legacy Hub products use the same ONE-2C completeness rules rather than a
  -- second hand-written readiness contract.
  v_specs_complete := private.one2c_specs_complete(p.category, p.subtype, p.specs);
  v_content_complete := private.one2c_listing_content_complete(
    p.category, p.subtype, p.brand, p.model, p.title, p.price
  );

  return v_specs_complete and v_content_complete;
end;
$$;

revoke all on function private.commerce_auto_publish_is_eligible(uuid) from public;
revoke all on function private.commerce_auto_publish_is_eligible(uuid) from anon;
revoke all on function private.commerce_auto_publish_is_eligible(uuid) from authenticated;

create or replace function private.refresh_commerce_auto_publish_for_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := true;
  v_delay integer := 180;
  v_live boolean := false;
begin
  select auto_publish_enabled, auto_publish_delay_seconds
    into v_enabled, v_delay
    from public.commerce_store_settings
   where id = 1;

  select exists(
    select 1
      from public.product_publications pp
     where pp.product_id = new.id
       and pp.channel = 'website'
       and pp.status = 'published'
  ) into v_live;

  if v_live or new.status in ('published','reserved') then
    update public.commerce_auto_publish_queue
       set status = 'published',
           published_at = coalesce(published_at, now()),
           locked_at = null,
           locked_by = null,
           last_error = null,
           updated_at = now()
     where product_id = new.id;
    return new;
  end if;

  if not coalesce(v_enabled, true)
     or not private.commerce_auto_publish_is_eligible(new.id) then
    update public.commerce_auto_publish_queue
       set status = 'cancelled',
           locked_at = null,
           locked_by = null,
           updated_at = now()
     where product_id = new.id
       and status in ('pending','processing');
    return new;
  end if;

  -- Any meaningful edit while still ready restarts the three-minute
  -- stabilization window. This avoids publishing mid-edit.
  insert into public.commerce_auto_publish_queue(
    product_id, eligible_at, publish_after, status, attempt_count,
    locked_at, locked_by, last_error, published_at, updated_at
  )
  values (
    new.id,
    now(),
    now() + make_interval(secs => coalesce(v_delay, 180)),
    'pending',
    0,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (product_id) do update
    set eligible_at = excluded.eligible_at,
        publish_after = excluded.publish_after,
        status = 'pending',
        attempt_count = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        published_at = null,
        updated_at = now();

  insert into public.activity_logs(actor_id, product_id, action, metadata)
  values (
    new.updated_by,
    new.id,
    'website_auto_publish_scheduled',
    jsonb_build_object(
      'delay_seconds', coalesce(v_delay, 180),
      'publish_after', now() + make_interval(secs => coalesce(v_delay, 180))
    )
  );

  return new;
end;
$$;

revoke all on function private.refresh_commerce_auto_publish_for_product() from public;
revoke all on function private.refresh_commerce_auto_publish_for_product() from anon;
revoke all on function private.refresh_commerce_auto_publish_for_product() from authenticated;

drop trigger if exists trg_commerce_auto_publish_product on public.products;
create trigger trg_commerce_auto_publish_product
after insert or update of
  status, one_photos_complete, one_specs_complete, one_listing_content_complete,
  sku, title, price, category, subtype, brand, model, specs
on public.products
for each row execute procedure private.refresh_commerce_auto_publish_for_product();

create or replace function private.refresh_commerce_auto_publish_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.auto_publish_enabled then
    update public.commerce_auto_publish_queue
       set status = 'cancelled',
           locked_at = null,
           locked_by = null,
           updated_at = now()
     where status in ('pending','processing');
    return new;
  end if;

  insert into public.commerce_auto_publish_queue(
    product_id, eligible_at, publish_after, status, attempt_count, updated_at
  )
  select
    p.id,
    now(),
    now() + make_interval(secs => new.auto_publish_delay_seconds),
    'pending',
    0,
    now()
  from public.products p
  where private.commerce_auto_publish_is_eligible(p.id)
    and not exists (
      select 1
        from public.product_publications pp
       where pp.product_id = p.id
         and pp.channel = 'website'
         and pp.status = 'published'
    )
  on conflict (product_id) do update
    set eligible_at = excluded.eligible_at,
        publish_after = excluded.publish_after,
        status = 'pending',
        attempt_count = 0,
        locked_at = null,
        locked_by = null,
        last_error = null,
        published_at = null,
        updated_at = now();

  return new;
end;
$$;

revoke all on function private.refresh_commerce_auto_publish_settings() from public;
revoke all on function private.refresh_commerce_auto_publish_settings() from anon;
revoke all on function private.refresh_commerce_auto_publish_settings() from authenticated;

drop trigger if exists trg_commerce_auto_publish_settings on public.commerce_store_settings;
create trigger trg_commerce_auto_publish_settings
after update of auto_publish_enabled, auto_publish_delay_seconds
on public.commerce_store_settings
for each row execute procedure private.refresh_commerce_auto_publish_settings();

create or replace function public.claim_commerce_auto_publish(
  p_worker_id text,
  p_limit integer default 10
)
returns table(
  product_id uuid,
  sku text,
  attempt_count integer,
  publish_after timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select q.product_id
      from public.commerce_auto_publish_queue q
     where (
       q.status = 'pending' and q.publish_after <= now()
     ) or (
       q.status = 'processing'
       and q.locked_at < now() - interval '10 minutes'
     )
     order by q.publish_after asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 10), 50))
  ),
  claimed as (
    update public.commerce_auto_publish_queue q
       set status = 'processing',
           attempt_count = q.attempt_count + 1,
           locked_at = now(),
           locked_by = left(coalesce(p_worker_id, 'worker'), 120),
           updated_at = now()
      from due
     where q.product_id = due.product_id
    returning q.product_id, q.attempt_count, q.publish_after
  )
  select c.product_id, p.sku, c.attempt_count, c.publish_after
    from claimed c
    join public.products p on p.id = c.product_id;
end;
$$;

revoke all on function public.claim_commerce_auto_publish(text,integer) from public;
revoke all on function public.claim_commerce_auto_publish(text,integer) from anon;
revoke all on function public.claim_commerce_auto_publish(text,integer) from authenticated;
grant execute on function public.claim_commerce_auto_publish(text,integer) to service_role;

create or replace function public.execute_commerce_auto_publish(
  target_product_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products%rowtype;
  v_category_id uuid;
  v_slug text;
  v_shop_origin text;
  v_url text;
  v_queue public.commerce_auto_publish_queue%rowtype;
begin
  select * into v_queue
    from public.commerce_auto_publish_queue
   where product_id = target_product_id
   for update;

  if v_queue.product_id is null
     or v_queue.status <> 'processing'
     or v_queue.locked_by is distinct from left(coalesce(p_worker_id, 'worker'), 120) then
    raise exception 'AUTO_PUBLISH_LOCK_MISMATCH';
  end if;

  if not private.commerce_auto_publish_is_eligible(target_product_id) then
    update public.commerce_auto_publish_queue
       set status = 'cancelled',
           locked_at = null,
           locked_by = null,
           last_error = 'PRODUCT_NO_LONGER_ELIGIBLE',
           updated_at = now()
     where product_id = target_product_id;
    return jsonb_build_object(
      'status','cancelled',
      'reason','PRODUCT_NO_LONGER_ELIGIBLE'
    );
  end if;

  if exists (
    select 1
      from public.product_publications pp
     where pp.product_id = target_product_id
       and pp.channel = 'website'
       and pp.status = 'published'
  ) then
    update public.commerce_auto_publish_queue
       set status = 'published',
           published_at = coalesce(published_at, now()),
           locked_at = null,
           locked_by = null,
           last_error = null,
           updated_at = now()
     where product_id = target_product_id;
    return jsonb_build_object('status','published','already_live',true);
  end if;

  select * into p
    from public.products
   where id = target_product_id
   for update;

  if p.id is null then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select c.id
    into v_category_id
    from public.commerce_categories c
   where c.is_active = true
     and c.source_category = p.category
     and (c.source_subtype = p.subtype or c.source_subtype is null)
   order by
     (c.source_subtype is not null) desc,
     c.is_default_source desc,
     c.sort_order asc
   limit 1;

  insert into public.commerce_listings(
    product_id,
    category_id,
    slug,
    seo_title,
    seo_description,
    index_policy,
    published_at
  )
  values (
    p.id,
    v_category_id,
    private.commerce_slug_base(p.title, p.sku),
    left(
      p.title || ' มือสอง ราคา '
        || trim(to_char(p.price, 'FM999999990'))
        || ' บาท | AMPHON TRADING',
      180
    ),
    left(
      concat_ws(
        ' ',
        p.title,
        case when p.brand is not null then 'แบรนด์ ' || p.brand end,
        'สินค้ามือสองพร้อมรูปจริง สเปก สภาพ ราคา และรายละเอียดสินค้าจาก AMPHON TRADING'
      ),
      300
    ),
    'INDEX',
    now()
  )
  on conflict (product_id) do update
    set category_id = coalesce(public.commerce_listings.category_id, excluded.category_id),
        index_policy = case
          when public.commerce_listings.index_policy = 'HOLD' then 'INDEX'
          else public.commerce_listings.index_policy
        end,
        published_at = coalesce(public.commerce_listings.published_at, excluded.published_at),
        updated_at = now();

  perform private.sync_commerce_listing_taxonomy(p.id);

  select cl.slug
    into v_slug
    from public.commerce_listings cl
   where cl.product_id = p.id;

  select regexp_replace(s.site_url, '/+$', '')
    into v_shop_origin
    from public.commerce_store_settings s
   where s.id = 1;

  v_url := v_shop_origin || '/p/' || v_slug || '-' || lower(p.sku) || '/';

  insert into public.product_publications(
    product_id,
    channel,
    status,
    external_url,
    listing_ref,
    notes,
    published_at,
    published_by,
    published_by_name,
    ended_at,
    ended_by,
    ended_by_name,
    updated_by,
    updated_by_name,
    last_action_id,
    updated_at
  )
  values (
    p.id,
    'website',
    'published',
    v_url,
    p.sku,
    'Auto-published after readiness delay',
    now(),
    null,
    'ระบบ Auto Publish',
    null,
    null,
    null,
    null,
    'ระบบ Auto Publish',
    gen_random_uuid(),
    now()
  )
  on conflict (product_id, channel) do update
    set status = 'published',
        external_url = excluded.external_url,
        listing_ref = excluded.listing_ref,
        notes = coalesce(public.product_publications.notes, excluded.notes),
        published_at = coalesce(
          public.product_publications.published_at,
          excluded.published_at
        ),
        published_by_name = coalesce(
          public.product_publications.published_by_name,
          excluded.published_by_name
        ),
        ended_at = null,
        ended_by = null,
        ended_by_name = null,
        updated_by = null,
        updated_by_name = excluded.updated_by_name,
        last_action_id = excluded.last_action_id,
        updated_at = now();

  -- Legacy Hub status keeps the existing Publish Center/Shop projection working.
  -- This does not modify one_availability or its version; AMPHON System remains
  -- the inventory availability authority.
  update public.products
     set status = 'published',
         updated_at = now()
   where id = p.id
     and status = 'ready_to_list';

  update public.commerce_auto_publish_queue
     set status = 'published',
         published_at = now(),
         locked_at = null,
         locked_by = null,
         last_error = null,
         updated_at = now()
   where product_id = p.id;

  insert into public.activity_logs(actor_id, product_id, action, metadata)
  values (
    null,
    p.id,
    'website_auto_published',
    jsonb_build_object(
      'source','commerce_auto_publish',
      'url',v_url,
      'attempt',v_queue.attempt_count
    )
  );

  return jsonb_build_object(
    'status','published',
    'url',v_url,
    'sku',p.sku
  );
end;
$$;

revoke all on function public.execute_commerce_auto_publish(uuid,text) from public;
revoke all on function public.execute_commerce_auto_publish(uuid,text) from anon;
revoke all on function public.execute_commerce_auto_publish(uuid,text) from authenticated;
grant execute on function public.execute_commerce_auto_publish(uuid,text) to service_role;

create or replace function public.fail_commerce_auto_publish(
  target_product_id uuid,
  p_worker_id text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.commerce_auto_publish_queue%rowtype;
  v_delay_minutes integer;
  v_status text;
begin
  select * into q
    from public.commerce_auto_publish_queue
   where product_id = target_product_id
   for update;

  if q.product_id is null
     or q.status <> 'processing'
     or q.locked_by is distinct from left(coalesce(p_worker_id, 'worker'), 120) then
    return jsonb_build_object('status','ignored','reason','LOCK_MISMATCH');
  end if;

  if q.attempt_count >= 5 then
    v_status := 'failed';

    update public.commerce_auto_publish_queue
       set status = 'failed',
           locked_at = null,
           locked_by = null,
           last_error = left(coalesce(p_error, 'AUTO_PUBLISH_FAILED'), 1500),
           updated_at = now()
     where product_id = target_product_id;
  else
    v_status := 'pending';
    v_delay_minutes := case q.attempt_count
      when 1 then 1
      when 2 then 5
      when 3 then 15
      else 30
    end;

    update public.commerce_auto_publish_queue
       set status = 'pending',
           publish_after = now() + make_interval(mins => v_delay_minutes),
           locked_at = null,
           locked_by = null,
           last_error = left(coalesce(p_error, 'AUTO_PUBLISH_FAILED'), 1500),
           updated_at = now()
     where product_id = target_product_id;
  end if;

  insert into public.activity_logs(actor_id, product_id, action, metadata)
  values (
    null,
    target_product_id,
    case
      when v_status = 'failed' then 'website_auto_publish_failed'
      else 'website_auto_publish_retry_scheduled'
    end,
    jsonb_build_object(
      'attempt',q.attempt_count,
      'error',left(coalesce(p_error,''),500)
    )
  );

  return jsonb_build_object('status',v_status,'attempt',q.attempt_count);
end;
$$;

revoke all on function public.fail_commerce_auto_publish(uuid,text,text) from public;
revoke all on function public.fail_commerce_auto_publish(uuid,text,text) from anon;
revoke all on function public.fail_commerce_auto_publish(uuid,text,text) from authenticated;
grant execute on function public.fail_commerce_auto_publish(uuid,text,text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.commerce_auto_publish_queue;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Existing eligible products enter the same stabilization queue on activation.
insert into public.commerce_auto_publish_queue(
  product_id, eligible_at, publish_after, status, attempt_count, updated_at
)
select
  p.id,
  now(),
  now() + interval '3 minutes',
  'pending',
  0,
  now()
from public.products p
where (select auto_publish_enabled from public.commerce_store_settings where id = 1)
  and private.commerce_auto_publish_is_eligible(p.id)
  and not exists (
    select 1
      from public.product_publications pp
     where pp.product_id = p.id
       and pp.channel = 'website'
       and pp.status = 'published'
  )
on conflict (product_id) do nothing;

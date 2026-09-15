-- ONE-2C Product Hub Enrichment Workflow
-- Source-only migration. Production activation is intentionally deferred to ONE-PROD.
--
-- Principles:
-- - No QC / Technical Inspection stage is added.
-- - Photos, specs and listing content are independent workstreams and may be completed in any order.
-- - Readiness is derived from saved product data; staff do not approve a second QC gate.
-- - Existing legacy products remain unchanged unless one_managed=true.
-- - Battery health is a simple grade: LOW / GOOD / VERY_GOOD / UNKNOWN.

create schema if not exists private;

alter table public.products
  add column if not exists one_enrichment_updated_at timestamptz,
  add column if not exists one_photos_completed_at timestamptz,
  add column if not exists one_specs_completed_at timestamptz,
  add column if not exists one_listing_content_completed_at timestamptz;

comment on column public.products.one_enrichment_updated_at is
  'Last time AMPHON ONE enrichment readiness changed.';
comment on column public.products.one_photos_completed_at is
  'Current photo-workstream completion timestamp; cleared if photos become incomplete.';
comment on column public.products.one_specs_completed_at is
  'Current spec-workstream completion timestamp; cleared if required specs become incomplete.';
comment on column public.products.one_listing_content_completed_at is
  'Current listing-content completion timestamp; cleared if listing content becomes incomplete.';

create or replace function private.one2c_has_text(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_value, '')), '') is not null
$$;

create or replace function private.one2c_has_spec(p_specs jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_specs ->> p_key, '')), '') is not null
$$;

create or replace function private.one2c_specs_complete(
  p_category text,
  p_subtype text,
  p_specs jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  p_specs := coalesce(p_specs, '{}'::jsonb);

  case p_category
    when 'notebook' then
      return private.one2c_has_spec(p_specs, 'cpu')
        and private.one2c_has_spec(p_specs, 'ram')
        and private.one2c_has_spec(p_specs, 'ssd');

    when 'pc' then
      return private.one2c_has_spec(p_specs, 'cpu')
        and private.one2c_has_spec(p_specs, 'mainboard')
        and private.one2c_has_spec(p_specs, 'ram')
        and private.one2c_has_spec(p_specs, 'ssd')
        and (
          coalesce(p_subtype, '') not in ('gaming', 'workstation')
          or private.one2c_has_spec(p_specs, 'gpu')
        );

    when 'iphone' then
      return private.one2c_has_spec(p_specs, 'storage')
        and private.one2c_has_spec(p_specs, 'face_id')
        and private.one2c_has_spec(p_specs, 'screen_condition')
        and private.one2c_has_spec(p_specs, 'repair_history');

    when 'smartphone' then
      return private.one2c_has_spec(p_specs, 'chipset')
        and private.one2c_has_spec(p_specs, 'ram')
        and private.one2c_has_spec(p_specs, 'storage')
        and private.one2c_has_spec(p_specs, 'screen_condition');

    when 'tablet' then
      return private.one2c_has_spec(p_specs, 'storage')
        and private.one2c_has_spec(p_specs, 'connectivity')
        and private.one2c_has_spec(p_specs, 'screen_condition');

    when 'camera' then
      return private.one2c_has_spec(p_specs, 'shutter')
        and private.one2c_has_spec(p_specs, 'sensor_condition');

    when 'lens' then
      return private.one2c_has_spec(p_specs, 'mount')
        and private.one2c_has_spec(p_specs, 'focal_length')
        and private.one2c_has_spec(p_specs, 'aperture')
        and private.one2c_has_spec(p_specs, 'autofocus')
        and private.one2c_has_spec(p_specs, 'front_glass')
        and private.one2c_has_spec(p_specs, 'internal_optics');

    when 'monitor' then
      return private.one2c_has_spec(p_specs, 'screen_size')
        and private.one2c_has_spec(p_specs, 'resolution')
        and private.one2c_has_spec(p_specs, 'refresh_rate')
        and private.one2c_has_spec(p_specs, 'dead_pixel');

    when 'gaming' then
      return private.one2c_has_spec(p_specs, 'storage')
        and private.one2c_has_spec(p_specs, 'stick_drift')
        and private.one2c_has_spec(p_specs, 'gaming_accessories');

    when 'component' then
      if p_subtype in ('cpu', 'mainboard') then
        return private.one2c_has_spec(p_specs, 'socket')
          and private.one2c_has_spec(p_specs, 'component_condition');
      elsif p_subtype = 'gpu' then
        return private.one2c_has_spec(p_specs, 'vram')
          and private.one2c_has_spec(p_specs, 'gpu_chip')
          and private.one2c_has_spec(p_specs, 'component_condition');
      elsif p_subtype = 'ram' then
        return private.one2c_has_spec(p_specs, 'ram_capacity')
          and private.one2c_has_spec(p_specs, 'component_condition');
      elsif p_subtype in ('ssd', 'hdd') then
        return private.one2c_has_spec(p_specs, 'storage_capacity')
          and private.one2c_has_spec(p_specs, 'storage_interface')
          and private.one2c_has_spec(p_specs, 'drive_health')
          and private.one2c_has_spec(p_specs, 'component_condition');
      elsif p_subtype = 'psu' then
        return private.one2c_has_spec(p_specs, 'wattage')
          and private.one2c_has_spec(p_specs, 'component_condition');
      else
        return private.one2c_has_spec(p_specs, 'component_condition');
      end if;

    when 'accessory' then
      return private.one2c_has_spec(p_specs, 'accessory_condition');

    when 'other' then
      return private.one2c_has_spec(p_specs, 'detail');

    else
      return false;
  end case;
end;
$$;

create or replace function private.one2c_listing_content_complete(
  p_category text,
  p_subtype text,
  p_brand text,
  p_model text,
  p_title text,
  p_price numeric
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    private.one2c_has_text(p_category)
    and private.one2c_has_text(p_subtype)
    and private.one2c_has_text(p_brand)
    and private.one2c_has_text(p_model)
    and private.one2c_has_text(p_title)
    and coalesce(p_price, 0) > 0
$$;

-- Before an employee writes product content, recompute the product-only workstreams.
-- The image workstream is recalculated separately after product_images changes.
create or replace function private.one2c_product_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_specs_complete boolean;
  v_content_complete boolean;
  v_now timestamptz := now();
  v_meaningful_edit boolean := false;
begin
  if not coalesce(new.one_managed, false) then
    return new;
  end if;

  v_specs_complete := private.one2c_specs_complete(new.category, new.subtype, new.specs);
  v_content_complete := private.one2c_listing_content_complete(
    new.category,
    new.subtype,
    new.brand,
    new.model,
    new.title,
    new.price
  );

  if tg_op = 'UPDATE' then
    v_meaningful_edit :=
      old.category is distinct from new.category
      or old.subtype is distinct from new.subtype
      or old.brand is distinct from new.brand
      or old.model is distinct from new.model
      or old.serial_number is distinct from new.serial_number
      or old.title is distinct from new.title
      or old.price is distinct from new.price
      or old.condition_percent is distinct from new.condition_percent
      or old.warranty_until is distinct from new.warranty_until
      or old.defects is distinct from new.defects
      or old.notes is distinct from new.notes
      or old.specs is distinct from new.specs
      or old.battery_health_grade is distinct from new.battery_health_grade;

    if v_meaningful_edit then
      new.one_enrichment_started := true;
    end if;
  end if;

  if new.one_specs_complete is distinct from v_specs_complete then
    new.one_specs_complete := v_specs_complete;
    new.one_specs_completed_at := case when v_specs_complete then v_now else null end;
    new.one_enrichment_updated_at := v_now;
  elsif v_specs_complete and new.one_specs_completed_at is null then
    new.one_specs_completed_at := v_now;
  end if;

  if new.one_listing_content_complete is distinct from v_content_complete then
    new.one_listing_content_complete := v_content_complete;
    new.one_listing_content_completed_at := case when v_content_complete then v_now else null end;
    new.one_enrichment_updated_at := v_now;
  elsif v_content_complete and new.one_listing_content_completed_at is null then
    new.one_listing_content_completed_at := v_now;
  end if;

  -- Keep the legacy Hub status compatible with existing Product/Publish screens,
  -- but ONE readiness remains the authoritative preparation state.
  if new.one_photos_complete and v_specs_complete and v_content_complete then
    if new.status in ('draft', 'photo_ready', 'ready_to_list') then
      new.status := 'ready_to_list';
    end if;
  elsif new.status = 'ready_to_list' then
    new.status := case when new.one_photos_complete then 'photo_ready' else 'draft' end;
  end if;

  return new;
end;
$$;

revoke all on function private.one2c_product_before_write() from public;

-- Recompute photo readiness after images change. Two saved images including a cover
-- is deliberately simple and fast for shop operations; no QC approval is introduced.
create or replace function private.one2c_after_image_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_actor_id uuid;
  v_photo_count integer;
  v_has_cover boolean;
  v_complete boolean;
  v_old_complete boolean;
begin
  if tg_op = 'DELETE' then
    v_product_id := old.product_id;
    v_actor_id := coalesce((select auth.uid()), old.created_by);
  else
    v_product_id := new.product_id;
    v_actor_id := coalesce((select auth.uid()), new.created_by);
  end if;

  select count(*)::integer, coalesce(bool_or(is_cover), false)
  into v_photo_count, v_has_cover
  from public.product_images
  where product_id = v_product_id;

  v_complete := v_photo_count >= 2 and v_has_cover;

  select one_photos_complete
  into v_old_complete
  from public.products
  where id = v_product_id
    and one_managed = true;

  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  update public.products
  set one_enrichment_started = true,
      one_photos_complete = v_complete,
      one_photos_completed_at = case
        when v_complete then coalesce(one_photos_completed_at, now())
        else null
      end,
      one_enrichment_updated_at = case
        when one_photos_complete is distinct from v_complete then now()
        else one_enrichment_updated_at
      end,
      updated_by = coalesce(v_actor_id, updated_by),
      updated_at = now()
  where id = v_product_id;

  if v_old_complete is distinct from v_complete then
    insert into public.activity_logs (actor_id, product_id, action, metadata)
    values (
      v_actor_id,
      v_product_id,
      'one_enrichment_photos_changed',
      jsonb_build_object(
        'complete', v_complete,
        'image_count', v_photo_count,
        'has_cover', v_has_cover,
        'source', 'one2c'
      )
    );
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.one2c_after_image_change() from public;

-- Queue an idempotent snapshot event whenever enrichment readiness changes.
create or replace function private.one2c_after_product_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_event_id uuid;
  v_idempotency text;
  v_payload jsonb;
begin
  if not coalesce(new.one_managed, false) then
    return new;
  end if;

  if not (
    old.one_enrichment_started is distinct from new.one_enrichment_started
    or old.one_photos_complete is distinct from new.one_photos_complete
    or old.one_specs_complete is distinct from new.one_specs_complete
    or old.one_listing_content_complete is distinct from new.one_listing_content_complete
    or old.one_listing_readiness is distinct from new.one_listing_readiness
    or old.battery_health_grade is distinct from new.battery_health_grade
  ) then
    return new;
  end if;

  v_actor_id := coalesce((select auth.uid()), new.updated_by);
  v_event_id := gen_random_uuid();
  v_idempotency := 'product-enrichment:' || new.id::text || ':' || txid_current()::text || ':v1';

  v_payload := jsonb_build_object(
    'eventId', v_event_id,
    'eventType', 'product.enrichment_changed',
    'version', 1,
    'source', 'product-hub',
    'occurredAt', now(),
    'idempotencyKey', v_idempotency,
    'entity', jsonb_build_object('type', 'product', 'id', new.id::text, 'sku', new.sku),
    'actor', case when v_actor_id is null then null else jsonb_build_object('type', 'user', 'id', v_actor_id::text) end,
    'payload', jsonb_build_object(
      'hubProductId', new.id::text,
      'sku', new.sku,
      'listingReadiness', new.one_listing_readiness,
      'photosComplete', new.one_photos_complete,
      'specsComplete', new.one_specs_complete,
      'listingContentComplete', new.one_listing_content_complete,
      'batteryHealthGrade', new.battery_health_grade
    )
  );

  insert into public.integration_event_outbox (
    event_id,
    destination,
    event_type,
    version,
    idempotency_key,
    entity_type,
    entity_id,
    entity_sku,
    payload
  ) values (
    v_event_id,
    'amphon-system',
    'product.enrichment_changed',
    1,
    v_idempotency,
    'product',
    new.id::text,
    new.sku,
    v_payload
  ) on conflict (destination, idempotency_key) do nothing;

  insert into public.activity_logs (actor_id, product_id, action, metadata)
  values (
    v_actor_id,
    new.id,
    'one_enrichment_changed',
    jsonb_build_object(
      'listing_readiness', new.one_listing_readiness,
      'photos_complete', new.one_photos_complete,
      'specs_complete', new.one_specs_complete,
      'listing_content_complete', new.one_listing_content_complete,
      'battery_health_grade', new.battery_health_grade,
      'source', 'one2c'
    )
  );

  return new;
end;
$$;

revoke all on function private.one2c_after_product_change() from public;

-- Product trigger runs only for fields that can affect enrichment readiness/start state.
drop trigger if exists trg_one2c_product_before_write on public.products;
create trigger trg_one2c_product_before_write
before insert or update of
  category,
  subtype,
  brand,
  model,
  serial_number,
  title,
  price,
  condition_percent,
  warranty_until,
  defects,
  notes,
  specs,
  battery_health_grade
on public.products
for each row
execute function private.one2c_product_before_write();

-- Queue readiness snapshots after the row reaches its final generated readiness value.
drop trigger if exists trg_one2c_product_after_change on public.products;
create trigger trg_one2c_product_after_change
after update on public.products
for each row
execute function private.one2c_after_product_change();

-- Product images can be added/removed/reordered independently from spec/content work.
drop trigger if exists trg_one2c_product_images_after_change on public.product_images;
create trigger trg_one2c_product_images_after_change
after insert or update or delete on public.product_images
for each row
execute function private.one2c_after_image_change();

-- Backfill is intentionally limited to ONE-managed products only.
-- This does not mark enrichment as started for untouched intake shells.
update public.products p
set one_specs_complete = private.one2c_specs_complete(p.category, p.subtype, p.specs),
    one_listing_content_complete = private.one2c_listing_content_complete(
      p.category, p.subtype, p.brand, p.model, p.title, p.price
    ),
    one_specs_completed_at = case
      when private.one2c_specs_complete(p.category, p.subtype, p.specs)
        then coalesce(p.one_specs_completed_at, now())
      else null
    end,
    one_listing_content_completed_at = case
      when private.one2c_listing_content_complete(p.category, p.subtype, p.brand, p.model, p.title, p.price)
        then coalesce(p.one_listing_content_completed_at, now())
      else null
    end
where p.one_managed = true;

with photo_state as (
  select
    p.id,
    count(pi.id)::integer as image_count,
    coalesce(bool_or(pi.is_cover), false) as has_cover
  from public.products p
  left join public.product_images pi on pi.product_id = p.id
  where p.one_managed = true
  group by p.id
)
update public.products p
set one_photos_complete = (s.image_count >= 2 and s.has_cover),
    one_photos_completed_at = case
      when s.image_count >= 2 and s.has_cover then coalesce(p.one_photos_completed_at, now())
      else null
    end
from photo_state s
where p.id = s.id;

comment on function private.one2c_specs_complete(text,text,jsonb) is
  'AMPHON ONE-2C category-aware required-spec readiness. Not a QC stage.';
comment on function private.one2c_listing_content_complete(text,text,text,text,text,numeric) is
  'AMPHON ONE-2C listing-content readiness: category/subtype/brand/model/title/price.';

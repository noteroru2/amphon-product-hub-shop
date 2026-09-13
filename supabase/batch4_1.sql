-- AMPHON Product Hub — Batch 4.1 Sales Website Integration
-- Run once after Batch 4. Safe to re-run.

-- Safe public projection used only by the Cloudflare Worker with the server-side secret key.
-- Sensitive fields are intentionally excluded: serial/IMEI, cost, internal notes, employee data.
create or replace view public.website_products as
select
  p.id as product_id,
  p.sku,
  p.category,
  p.subtype,
  p.brand,
  p.model,
  p.title,
  p.status,
  p.condition_percent,
  p.price,
  p.warranty_until,
  p.defects,
  p.specs,
  p.updated_at,
  pp.published_at,
  pp.updated_at as publication_updated_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'url', pi.public_url,
          'role', pi.image_role,
          'isCover', pi.is_cover,
          'sortOrder', pi.sort_order
        )
        order by pi.is_cover desc, pi.sort_order asc, pi.created_at asc
      )
      from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
    ),
    '[]'::jsonb
  ) as images
from public.products p
join public.product_publications pp
  on pp.product_id = p.id
 and pp.channel = 'website'
 and pp.status = 'published'
where p.status in ('published', 'reserved')
  and p.price is not null
  and p.price > 0;

-- Keep the view server-only. The public browser never talks to Supabase directly for store data.
revoke all on public.website_products from anon;
revoke all on public.website_products from authenticated;
grant select on public.website_products to service_role;

create index if not exists product_publications_website_live_idx
on public.product_publications(product_id, updated_at desc)
where channel = 'website' and status = 'published';

-- When inventory becomes unavailable, remove it from the sales website automatically.
create or replace function public.auto_end_website_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_name text;
  changed_count integer := 0;
begin
  if new.status in ('sold', 'returned', 'cancelled')
     and old.status is distinct from new.status then
    select p.display_name
      into actor_name
      from public.profiles p
      where p.id = new.updated_by
      limit 1;

    update public.product_publications
       set status = 'ended',
           ended_at = now(),
           ended_by = new.updated_by,
           ended_by_name = coalesce(actor_name, 'ระบบ'),
           updated_by = new.updated_by,
           updated_by_name = coalesce(actor_name, 'ระบบ'),
           notes = case
             when coalesce(notes, '') = '' then 'Auto-unpublished: product status changed to ' || new.status
             else notes
           end
     where product_id = new.id
       and channel = 'website'
       and status = 'published';

    get diagnostics changed_count = row_count;

    if changed_count > 0 then
      insert into public.activity_logs(actor_id, product_id, action, metadata)
      values (
        new.updated_by,
        new.id,
        'website_auto_unpublished',
        jsonb_build_object('product_status', new.status, 'count', changed_count)
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.auto_end_website_publication() from public;

drop trigger if exists products_auto_end_website_publication on public.products;
create trigger products_auto_end_website_publication
after update of status on public.products
for each row execute procedure public.auto_end_website_publication();

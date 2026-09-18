-- Enable Google Merchant feed for eligible AMPHON SHOP listings and
-- keep future Website publications Merchant-enabled automatically.
-- Merchant eligibility never owns stock; AMPHON System remains availability master.

create or replace function private.sync_merchant_from_website_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.channel <> 'website' then
    return new;
  end if;

  if new.status = 'published' then
    update public.commerce_listings cl
       set merchant_enabled = (
             cl.index_policy = 'INDEX'
             and exists (
               select 1
                 from public.products p
                where p.id = new.product_id
                  and p.status in ('ready_to_list','published','reserved')
                  and p.price > 0
                  and p.one_availability is distinct from 'SOLD'
                  and exists (
                    select 1
                      from public.product_images pi
                     where pi.product_id = p.id
                       and pi.public_url is not null
                  )
             )
           ),
           updated_at = now()
     where cl.product_id = new.product_id;
  else
    update public.commerce_listings
       set merchant_enabled = false,
           updated_at = now()
     where product_id = new.product_id;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_merchant_from_website_publication() from public;
revoke all on function private.sync_merchant_from_website_publication() from anon;
revoke all on function private.sync_merchant_from_website_publication() from authenticated;

drop trigger if exists trg_sync_merchant_from_website_publication
  on public.product_publications;

create trigger trg_sync_merchant_from_website_publication
after insert or update of channel, status
on public.product_publications
for each row
execute procedure private.sync_merchant_from_website_publication();

update public.commerce_listings cl
   set merchant_enabled = true,
       updated_at = now()
  from public.products p
 where p.id = cl.product_id
   and cl.index_policy = 'INDEX'
   and p.status = 'published'
   and p.price > 0
   and p.one_availability is distinct from 'SOLD'
   and exists (
     select 1
       from public.product_images pi
      where pi.product_id = p.id
        and pi.public_url is not null
   )
   and exists (
     select 1
       from public.product_publications pp
      where pp.product_id = p.id
        and pp.channel = 'website'
        and pp.status = 'published'
   );

comment on function private.sync_merchant_from_website_publication() is
  'Keeps Merchant feed intent aligned to published Website listings. Availability remains AMPHON System-owned.';

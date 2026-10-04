alter table public.facebook_rotation_queue add column if not exists lane text not null default 'ROTATION';
create unique index if not exists facebook_new_arrival_once_per_page on public.facebook_rotation_queue(product_id,connection_key,lane) where lane='NEW_ARRIVAL';
create or replace function public.facebook_enqueue_new_arrival() returns trigger language plpgsql security definer set search_path=public as $$
declare k text; pages text[]; became_ready boolean;
begin
 became_ready := new.one_listing_readiness='READY_TO_LIST' and new.one_availability='IN_STOCK' and new.status in('ready_to_list','published','reserved') and (tg_op='INSERT' or old.one_listing_readiness is distinct from 'READY_TO_LIST' or old.one_availability is distinct from 'IN_STOCK' or old.status not in('ready_to_list','published','reserved'));
 if not became_ready then return new; end if;
 select active_connection_keys into pages from public.facebook_rotation_settings where id=true and enabled=true and dry_run=false;
 foreach k in array coalesce(pages,array[]::text[]) loop insert into public.facebook_rotation_queue(product_id,connection_key,scheduled_at,week_key,rotation_no,template_id,status,lane) values(new.id,k,now()+interval '5 minutes','NEW-'||to_char(now() at time zone 'Asia/Bangkok','IYYY-IW'),0,'NEW-ARRIVAL','PLANNED','NEW_ARRIVAL') on conflict do nothing; end loop;
 return new;
end $$;
drop trigger if exists trg_facebook_new_arrival on public.products;
create trigger trg_facebook_new_arrival after insert or update on public.products for each row execute function public.facebook_enqueue_new_arrival();
update public.facebook_rotation_settings set page_daily_budget=6,min_page_gap_minutes=25,updated_at=now() where id=true;
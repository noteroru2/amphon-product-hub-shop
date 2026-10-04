-- Reach-first rotation: up to six scheduled rotation posts per page/day.
create or replace function public.facebook_rotation_generate_week(target_date date default ((now() at time zone 'Asia/Bangkok')::date))
returns integer language plpgsql security definer set search_path=public as $$
declare wk text; monday date; inserted_count int:=0; p record; product_no int:=0; rot int; day_offset int; slot int; local_ts timestamp; page_key text; pages text[]; pick record; page_slots time[];
begin
 monday:=target_date-(extract(isodow from target_date)::int-1); wk:=to_char(monday,'IYYY-IW');
 if exists(select 1 from public.facebook_rotation_queue where week_key=wk and lane='ROTATION') then return 0; end if;
 select active_connection_keys into pages from public.facebook_rotation_settings where id=true and enabled=true and dry_run=false;
 if coalesce(array_length(pages,1),0)=0 then return 0; end if;
 for p in select id,coalesce(one_stock_age_days,0) age_days from public.products where status in('ready_to_list','published','reserved') and one_availability='IN_STOCK' order by coalesce(one_stock_age_days,0) desc,updated_at desc,id loop
  for rot in 1..2 loop
   page_key:=pages[((product_no+rot-1)%array_length(pages,1))+1]; day_offset:=(product_no+(rot-1)*3)%7; slot:=(product_no+rot-1)%6;
   if page_key='page_1' then page_slots:=array[time '10:45',time '11:50',time '13:05',time '18:20',time '19:35',time '20:50']; else page_slots:=array[time '11:15',time '12:20',time '13:35',time '18:50',time '20:05',time '21:20']; end if;
   local_ts:=monday::timestamp+day_offset*interval '1 day'+page_slots[slot+1];
   select * into pick from public.facebook_learning_pick(page_key,extract(dow from local_ts)::smallint,extract(hour from local_ts)::smallint,'ROT-'||(((product_no+rot-1)%8)+1));
   if (select count(*) from public.facebook_rotation_queue q where q.lane='ROTATION' and q.connection_key=page_key and (q.scheduled_at at time zone 'Asia/Bangkok')::date=local_ts::date and q.status in('PLANNED','CLAIMED','POSTED'))<6 and not exists(select 1 from public.facebook_rotation_queue q where q.lane='ROTATION' and q.product_id=p.id and q.status in('PLANNED','CLAIMED','POSTED') and abs(extract(epoch from(q.scheduled_at-(local_ts at time zone 'Asia/Bangkok'))))<259200) then
    insert into public.facebook_rotation_queue(product_id,connection_key,scheduled_at,week_key,rotation_no,template_id,status,lane) values(p.id,page_key,local_ts at time zone 'Asia/Bangkok',wk,rot,pick.template_id,'PLANNED','ROTATION') on conflict do nothing; if found then inserted_count:=inserted_count+1; end if;
   end if;
  end loop; product_no:=product_no+1;
 end loop;
 update public.facebook_rotation_settings set last_generated_week=wk,last_generated_at=now() where id=true; return inserted_count;
end $$;
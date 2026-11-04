begin;
create table if not exists public.ai_buyer_chat_price_batches(
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id) on delete cascade,
 actor_id uuid not null references auth.users(id),
 request_text text not null default '' check (length(request_text)<=2000),
 item_count integer not null check(item_count between 1 and 20),
 before_data jsonb not null,
 after_data jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists ai_buyer_chat_price_batches_draft on public.ai_buyer_chat_price_batches(draft_id,created_at desc);
alter table public.ai_buyer_chat_price_batches enable row level security;
revoke all on public.ai_buyer_chat_price_batches from public,anon,authenticated;
grant select on public.ai_buyer_chat_price_batches to authenticated;
drop policy if exists ai_buyer_chat_price_owner_select on public.ai_buyer_chat_price_batches;
create policy ai_buyer_chat_price_owner_select on public.ai_buyer_chat_price_batches for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));

create or replace function public.ai_buyer_chat_price_apply(
 p_draft_id uuid,p_items jsonb,p_request_text text default ''
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); source_rec public.ai_buyer_pb28_entries%rowtype;
 d public.ai_buyer_pb28_drafts%rowtype; item jsonb; items_count integer;
 old_data jsonb:='[]'::jsonb; new_data jsonb:='[]'::jsonb;
 identity_key text; identities text[]:='{}'; entry_id uuid; batch_id uuid;
 new_row jsonb; expected_id uuid; expected_at timestamptz; previous_json jsonb;
begin
 if actor is null or not exists(
  select 1 from public.profiles p where p.id=actor and p.active and p.role='owner'
 ) then raise exception 'CHAT_PRICE_OWNER_REQUIRED' using errcode='42501';end if;
 if p_items is null or pg_catalog.jsonb_typeof(p_items)<>'array' then raise exception 'CHAT_PRICE_ITEMS_INVALID';end if;
 items_count:=pg_catalog.jsonb_array_length(p_items);
 if items_count<1 or items_count>20 or length(coalesce(p_request_text,''))>2000 then raise exception 'CHAT_PRICE_BATCH_INVALID';end if;
 select * into d from public.ai_buyer_pb28_drafts where id=p_draft_id and status='DRAFT' for update;
 if not found then raise exception 'CHAT_PRICE_DRAFT_NOT_EDITABLE';end if;
 for item in select value from pg_catalog.jsonb_array_elements(p_items) loop
  if pg_catalog.jsonb_typeof(item)<>'object' then raise exception 'CHAT_PRICE_ROW_INVALID';end if;
  if length(btrim(coalesce(item->>'model',''))) not between 2 and 180 or
     length(btrim(coalesce(item->>'category',''))) not between 2 and 60 or
     coalesce(item->>'active','false')<>'false'
  then raise exception 'CHAT_PRICE_IDENTITY_OR_ACTIVE_INVALID';end if;
  -- All numeric values are required and finite; unchanged text metadata must be explicit.
  if item->>'estimated_resale' is null or item->>'opening_offer' is null or
     item->>'target_buy' is null or item->>'hard_max' is null
  then raise exception 'CHAT_PRICE_VALUES_REQUIRED';end if;
  identity_key:=lower(concat_ws('|',btrim(coalesce(item->>'category','')),btrim(coalesce(item->>'brand','')),
    btrim(item->>'model'),btrim(coalesce(item->>'model_code','')),btrim(coalesce(item->>'condition_key','NORMAL'))));
  if identity_key=any(identities) then raise exception 'CHAT_PRICE_DUPLICATE_IDENTITY';end if;
  identities:=array_append(identities,identity_key);
  expected_id:=nullif(item->>'expected_entry_id','')::uuid;
  expected_at:=nullif(item->>'expected_updated_at','')::timestamptz;
  select * into source_rec from public.ai_buyer_pb28_entries
  where draft_id=p_draft_id and lower(btrim(category))=lower(btrim(item->>'category'))
   and lower(btrim(brand))=lower(btrim(coalesce(item->>'brand','')))
   and lower(btrim(model))=lower(btrim(item->>'model'))
   and lower(btrim(model_code))=lower(btrim(coalesce(item->>'model_code','')))
   and lower(btrim(condition_key))=lower(btrim(coalesce(item->>'condition_key','NORMAL')))
  for update;
  if found then
   if expected_id is null or expected_at is null or expected_id<>source_rec.id or expected_at<>source_rec.updated_at
   then raise exception 'CHAT_PRICE_STALE_PREVIEW';end if;
   previous_json:=to_jsonb(source_rec);
   if previous_json->'estimated_resale' is distinct from item->'expected_estimated_resale' or
      previous_json->'opening_offer' is distinct from item->'expected_opening_offer' or
      previous_json->'target_buy' is distinct from item->'expected_target_buy' or
      previous_json->'hard_max' is distinct from item->'expected_hard_max'
   then raise exception 'CHAT_PRICE_STALE_VALUES';end if;
  else
   if expected_id is not null or expected_at is not null then raise exception 'CHAT_PRICE_ENTRY_REMOVED';end if;
   previous_json:='null'::jsonb;
  end if;
  new_row:=pg_catalog.jsonb_build_object(
    'category',btrim(item->>'category'),'brand',btrim(coalesce(item->>'brand','')),
    'model',btrim(item->>'model'),'model_code',btrim(coalesce(item->>'model_code','')),
    'condition_key',btrim(coalesce(item->>'condition_key','NORMAL')),
    'estimated_resale',(item->>'estimated_resale')::numeric,
    'opening_offer',(item->>'opening_offer')::numeric,
    'target_buy',(item->>'target_buy')::numeric,
    'hard_max',(item->>'hard_max')::numeric,
    'active',false,
    'note',left(coalesce(item->>'note',case when found then source_rec.note else '' end),800),
    'aliases',case when found then source_rec.aliases else '[]'::jsonb end,
    'spec_match',case when found then source_rec.spec_match else '{}'::jsonb end,
    'adjustments',case when found then source_rec.adjustments else '{}'::jsonb end
  );
  -- All writes are to isolated V2.8 Draft through pre-existing audited RPC.
  entry_id:=public.ai_buyer_pb28_save_entry(p_draft_id,expected_id,new_row);
  old_data:=old_data||pg_catalog.jsonb_build_array(previous_json);
  new_data:=new_data||pg_catalog.jsonb_build_array(
   (select to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=entry_id)
  );
 end loop;
 insert into public.ai_buyer_chat_price_batches(draft_id,actor_id,request_text,item_count,before_data,after_data)
 values(p_draft_id,actor,coalesce(p_request_text,''),items_count,old_data,new_data)
 returning id into batch_id;
 return batch_id;
end;$$;
revoke all on function public.ai_buyer_chat_price_apply(uuid,jsonb,text) from public,anon;
grant execute on function public.ai_buyer_chat_price_apply(uuid,jsonb,text) to authenticated;
commit;
begin;
alter table public.ai_buyer_pb28_entries add column if not exists aliases jsonb not null default '[]'::jsonb;
alter table public.ai_buyer_pb28_entries add column if not exists spec_match jsonb not null default '{}'::jsonb;
alter table public.ai_buyer_pb28_entries add column if not exists adjustments jsonb not null default '{}'::jsonb;
create or replace function public.ai_buyer_pb28_create_draft(p_title text, p_clone_active boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; draft uuid; source uuid; copied integer:=0;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'PB28_TITLE_INVALID'; end if;
 if p_clone_active then
   select v.id into source from public.ai_buyer_price_book_versions v where v.status='ACTIVE' order by v.activated_at desc limit 1;
   if source is null then raise exception 'PB28_ACTIVE_SOURCE_MISSING'; end if;
 end if;
 insert into public.ai_buyer_pb28_drafts(title,source_version_id,created_by)
 values(btrim(p_title),source,actor) returning id into draft;
 if source is not null then
  insert into public.ai_buyer_pb28_entries(draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note,aliases,spec_match,adjustments)
  select draft,e.category,coalesce(e.brand,''),e.model,coalesce(e.model_code,''),e.condition_key,
    coalesce(e.estimated_resale,greatest(e.hard_max,1)),e.opening_offer,e.target_buy,e.hard_max,e.active,
    'Copied from previous active PriceBook (review before publish)',e.aliases,e.spec_match,e.adjustments
  from public.ai_buyer_price_book_entries e where e.version_id=source;
  get diagnostics copied=row_count;
 end if;
 insert into public.ai_buyer_pb28_audit(draft_id,actor_id,action,after_data)
 values(draft,actor,case when source is null then 'CREATE_DRAFT' else 'CLONE_DRAFT' end,
  pg_catalog.jsonb_build_object('title',btrim(p_title),'source_version_id',source,'copied',copied));
 return draft;
end; $$;
create or replace function public.ai_buyer_pb28_save_entry(p_draft_id uuid,p_entry_id uuid,p_row jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; rec public.ai_buyer_pb28_entries%rowtype; old jsonb; output_id uuid; r numeric; o numeric; t numeric; h numeric;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 perform 1 from public.ai_buyer_pb28_drafts where id=p_draft_id and status='DRAFT' for update;
 if not found then raise exception 'PB28_DRAFT_NOT_FOUND'; end if;
 if p_row is null or jsonb_typeof(p_row)<>'object' then raise exception 'PB28_ROW_INVALID'; end if;
 if length(btrim(coalesce(p_row->>'category',''))) not between 2 and 60 or length(btrim(coalesce(p_row->>'model',''))) not between 1 and 180 then raise exception 'PB28_IDENTITY_REQUIRED'; end if;
 if length(coalesce(p_row->>'note',''))>800 then raise exception 'PB28_NOTE_TOO_LONG'; end if;
 if (p_row ? 'aliases' and jsonb_typeof(p_row->'aliases')<>'array')
  or (p_row ? 'spec_match' and jsonb_typeof(p_row->'spec_match')<>'object')
  or (p_row ? 'adjustments' and jsonb_typeof(p_row->'adjustments')<>'object')
 then raise exception 'PB28_MATCHING_JSON_INVALID'; end if;
 begin
  r:=(p_row->>'estimated_resale')::numeric; o:=(p_row->>'opening_offer')::numeric;
  t:=(p_row->>'target_buy')::numeric; h:=(p_row->>'hard_max')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'PB28_AMOUNT_INVALID'; end;
 if r is null or o is null or t is null or h is null or r<=0 or o<0 or o>t or t>h or h>r then raise exception 'PB28_PRICE_ORDER_INVALID'; end if;
 if p_entry_id is null then
  insert into public.ai_buyer_pb28_entries(draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note,aliases,spec_match,adjustments)
  values(p_draft_id,btrim(p_row->>'category'),btrim(coalesce(p_row->>'brand','')),btrim(p_row->>'model'),btrim(coalesce(p_row->>'model_code','')),
    coalesce(nullif(btrim(p_row->>'condition_key'),''),'NORMAL'),r,o,t,h,coalesce((p_row->>'active')::boolean,true),coalesce(p_row->>'note',''),coalesce(p_row->'aliases','[]'::jsonb),coalesce(p_row->'spec_match','{}'::jsonb),coalesce(p_row->'adjustments','{}'::jsonb))
  returning id into output_id;
  insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,after_data)
  select p_draft_id,e.id,actor,'CREATE_ENTRY',to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=output_id;
 else
  select to_jsonb(e) into old from public.ai_buyer_pb28_entries e where e.id=p_entry_id and e.draft_id=p_draft_id for update;
  if old is null then raise exception 'PB28_ENTRY_NOT_FOUND'; end if;
  update public.ai_buyer_pb28_entries set category=btrim(p_row->>'category'),brand=btrim(coalesce(p_row->>'brand','')),
   model=btrim(p_row->>'model'),model_code=btrim(coalesce(p_row->>'model_code','')),
   condition_key=coalesce(nullif(btrim(p_row->>'condition_key'),''),'NORMAL'),estimated_resale=r,opening_offer=o,target_buy=t,hard_max=h,
   active=coalesce((p_row->>'active')::boolean,true),note=coalesce(p_row->>'note',''),aliases=coalesce(p_row->'aliases',aliases),spec_match=coalesce(p_row->'spec_match',spec_match),adjustments=coalesce(p_row->'adjustments',adjustments),updated_at=now()
  where id=p_entry_id and draft_id=p_draft_id returning id into output_id;
  insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,before_data,after_data)
  select p_draft_id,e.id,actor,'UPDATE_ENTRY',old,to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=output_id;
 end if;
 update public.ai_buyer_pb28_drafts set updated_at=now() where id=p_draft_id;
 return output_id;
end; $$;
commit;
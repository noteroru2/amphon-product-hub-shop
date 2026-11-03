-- PriceBook V2.8 Draft Admin foundation: isolated from legacy active PriceBook.
-- No activation, LINE, or production price changes are performed by these functions.
begin;

create table if not exists public.ai_buyer_pb28_drafts (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 3 and 160),
 status text not null default 'DRAFT' check(status='DRAFT'),
 source_version_id uuid references public.ai_buyer_price_book_versions(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.ai_buyer_pb28_entries (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id) on delete cascade,
 category text not null check(length(btrim(category)) between 2 and 60),
 brand text not null default '',
 model text not null check(length(btrim(model)) between 1 and 180),
 model_code text not null default '',
 condition_key text not null default 'NORMAL',
 estimated_resale numeric(12,2) not null check (estimated_resale>0),
 opening_offer numeric(12,2) not null check (opening_offer>=0),
 target_buy numeric(12,2) not null check (target_buy>=opening_offer),
 hard_max numeric(12,2) not null check (hard_max>=target_buy and hard_max<=estimated_resale),
 active boolean not null default true,
 note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists pb28_entry_identity_unique on public.ai_buyer_pb28_entries
 (draft_id,lower(btrim(category)),lower(btrim(brand)),lower(btrim(model)),lower(btrim(model_code)),lower(btrim(condition_key)));
create index if not exists pb28_entries_draft_idx on public.ai_buyer_pb28_entries(draft_id);
create table if not exists public.ai_buyer_pb28_audit (
 id bigint generated always as identity primary key,
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id) on delete cascade,
 entry_id uuid,
 actor_id uuid not null references auth.users(id),
 action text not null check (action in ('CREATE_DRAFT','CLONE_DRAFT','CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY','BULK_EDIT','IMPORT_ENTRIES')),
 before_data jsonb,
 after_data jsonb,
 created_at timestamptz not null default now()
);
create index if not exists pb28_audit_draft_date_idx on public.ai_buyer_pb28_audit(draft_id,created_at desc);

alter table public.ai_buyer_pb28_drafts enable row level security;
alter table public.ai_buyer_pb28_entries enable row level security;
alter table public.ai_buyer_pb28_audit enable row level security;
revoke all on public.ai_buyer_pb28_drafts,public.ai_buyer_pb28_entries,public.ai_buyer_pb28_audit from public,anon,authenticated;
grant select on public.ai_buyer_pb28_drafts,public.ai_buyer_pb28_entries,public.ai_buyer_pb28_audit to authenticated;
drop policy if exists pb28_admin_read on public.ai_buyer_pb28_drafts;
drop policy if exists pb28_admin_read on public.ai_buyer_pb28_entries;
drop policy if exists pb28_admin_read on public.ai_buyer_pb28_audit;
create policy pb28_admin_read on public.ai_buyer_pb28_drafts for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));
create policy pb28_admin_read on public.ai_buyer_pb28_entries for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));
create policy pb28_admin_read on public.ai_buyer_pb28_audit for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));

create or replace function public.ai_buyer_pb28_require_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role in ('owner','admin'))
 then raise exception 'PB28_ADMIN_REQUIRED' using errcode='42501'; end if;
 return actor;
end; $$;
revoke all on function public.ai_buyer_pb28_require_admin() from public,anon,authenticated;
-- Internal helper invoked by definer functions.

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
  insert into public.ai_buyer_pb28_entries(draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note)
  select draft,e.category,coalesce(e.brand,''),e.model,coalesce(e.model_code,''),e.condition_key,
    coalesce(e.estimated_resale,greatest(e.hard_max,1)),e.opening_offer,e.target_buy,e.hard_max,e.active,
    'Copied from previous active PriceBook (review before publish)'
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
 begin
  r:=(p_row->>'estimated_resale')::numeric; o:=(p_row->>'opening_offer')::numeric;
  t:=(p_row->>'target_buy')::numeric; h:=(p_row->>'hard_max')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'PB28_AMOUNT_INVALID'; end;
 if r is null or o is null or t is null or h is null or r<=0 or o<0 or o>t or t>h or h>r then raise exception 'PB28_PRICE_ORDER_INVALID'; end if;
 if p_entry_id is null then
  insert into public.ai_buyer_pb28_entries(draft_id,category,brand,model,model_code,condition_key,estimated_resale,opening_offer,target_buy,hard_max,active,note)
  values(p_draft_id,btrim(p_row->>'category'),btrim(coalesce(p_row->>'brand','')),btrim(p_row->>'model'),btrim(coalesce(p_row->>'model_code','')),
    coalesce(nullif(btrim(p_row->>'condition_key'),''),'NORMAL'),r,o,t,h,coalesce((p_row->>'active')::boolean,true),coalesce(p_row->>'note',''))
  returning id into output_id;
  insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,after_data)
  select p_draft_id,e.id,actor,'CREATE_ENTRY',to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=output_id;
 else
  select to_jsonb(e) into old from public.ai_buyer_pb28_entries e where e.id=p_entry_id and e.draft_id=p_draft_id for update;
  if old is null then raise exception 'PB28_ENTRY_NOT_FOUND'; end if;
  update public.ai_buyer_pb28_entries set category=btrim(p_row->>'category'),brand=btrim(coalesce(p_row->>'brand','')),
   model=btrim(p_row->>'model'),model_code=btrim(coalesce(p_row->>'model_code','')),
   condition_key=coalesce(nullif(btrim(p_row->>'condition_key'),''),'NORMAL'),estimated_resale=r,opening_offer=o,target_buy=t,hard_max=h,
   active=coalesce((p_row->>'active')::boolean,true),note=coalesce(p_row->>'note',''),updated_at=now()
  where id=p_entry_id and draft_id=p_draft_id returning id into output_id;
  insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,before_data,after_data)
  select p_draft_id,e.id,actor,'UPDATE_ENTRY',old,to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=output_id;
 end if;
 update public.ai_buyer_pb28_drafts set updated_at=now() where id=p_draft_id;
 return output_id;
end; $$;

create or replace function public.ai_buyer_pb28_delete_entry(p_draft_id uuid,p_entry_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid; old jsonb;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 perform 1 from public.ai_buyer_pb28_drafts where id=p_draft_id and status='DRAFT' for update;
 if not found then raise exception 'PB28_DRAFT_NOT_FOUND'; end if;
 select to_jsonb(e) into old from public.ai_buyer_pb28_entries e where e.id=p_entry_id and e.draft_id=p_draft_id for update;
 if old is null then raise exception 'PB28_ENTRY_NOT_FOUND'; end if;
 delete from public.ai_buyer_pb28_entries where id=p_entry_id and draft_id=p_draft_id;
 insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,before_data) values(p_draft_id,p_entry_id,actor,'DELETE_ENTRY',old);
 update public.ai_buyer_pb28_drafts set updated_at=now() where id=p_draft_id;
 return true;
end; $$;

create or replace function public.ai_buyer_pb28_bulk_edit(p_draft_id uuid,p_entry_ids uuid[],p_field text,p_delta numeric)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; rec public.ai_buyer_pb28_entries%rowtype; old jsonb; affected integer:=0; n numeric;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 if p_field not in ('opening_offer','target_buy','hard_max','estimated_resale') or p_delta is null or abs(p_delta)>1000000 then raise exception 'PB28_BULK_INPUT_INVALID'; end if;
 if p_entry_ids is null or cardinality(p_entry_ids) between 1 and 100 is not true then raise exception 'PB28_BULK_SIZE_INVALID'; end if;
 if cardinality(array(select distinct unnest(p_entry_ids)))<>cardinality(p_entry_ids) then raise exception 'PB28_DUPLICATE_SELECTION'; end if;
 perform 1 from public.ai_buyer_pb28_drafts where id=p_draft_id and status='DRAFT' for update;
 if not found then raise exception 'PB28_DRAFT_NOT_FOUND'; end if;
 for rec in select * from public.ai_buyer_pb28_entries where draft_id=p_draft_id and id=any(p_entry_ids) for update loop
  old:=to_jsonb(rec); n:=(old->>p_field)::numeric+p_delta;
  if n<0 then raise exception 'PB28_PRICE_ORDER_INVALID'; end if;
  update public.ai_buyer_pb28_entries set
    estimated_resale=case when p_field='estimated_resale' then n else estimated_resale end,
    opening_offer=case when p_field='opening_offer' then n else opening_offer end,
    target_buy=case when p_field='target_buy' then n else target_buy end,
    hard_max=case when p_field='hard_max' then n else hard_max end,
    updated_at=now()
  where id=rec.id;
  insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,before_data,after_data)
  select p_draft_id,e.id,actor,'BULK_EDIT',old,to_jsonb(e) from public.ai_buyer_pb28_entries e where e.id=rec.id;
  affected:=affected+1;
 end loop;
 if affected<>cardinality(p_entry_ids) then raise exception 'PB28_SELECTION_STALE'; end if;
 update public.ai_buyer_pb28_drafts set updated_at=now() where id=p_draft_id;
 return affected;
end; $$;

-- Caller may atomically import rows after local CSV preview.
create or replace function public.ai_buyer_pb28_import_rows(p_draft_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; row_value jsonb; count_rows integer; output_id uuid;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 if jsonb_typeof(p_rows)<>'array' then raise exception 'PB28_IMPORT_INVALID'; end if;
 count_rows:=jsonb_array_length(p_rows);
 if count_rows<1 or count_rows>250 then raise exception 'PB28_IMPORT_SIZE_INVALID'; end if;
 perform 1 from public.ai_buyer_pb28_drafts where id=p_draft_id and status='DRAFT' for update;
 if not found then raise exception 'PB28_DRAFT_NOT_FOUND'; end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  output_id:=public.ai_buyer_pb28_save_entry(p_draft_id,null,row_value);
 end loop;
 insert into public.ai_buyer_pb28_audit(draft_id,actor_id,action,after_data) values(p_draft_id,actor,'IMPORT_ENTRIES',jsonb_build_object('count',count_rows));
 return count_rows;
end; $$;

revoke all on function public.ai_buyer_pb28_create_draft(text,boolean), public.ai_buyer_pb28_save_entry(uuid,uuid,jsonb),
 public.ai_buyer_pb28_delete_entry(uuid,uuid),public.ai_buyer_pb28_bulk_edit(uuid,uuid[],text,numeric),
 public.ai_buyer_pb28_import_rows(uuid,jsonb) from public,anon;
grant execute on function public.ai_buyer_pb28_create_draft(text,boolean), public.ai_buyer_pb28_save_entry(uuid,uuid,jsonb),
 public.ai_buyer_pb28_delete_entry(uuid,uuid),public.ai_buyer_pb28_bulk_edit(uuid,uuid[],text,numeric),
 public.ai_buyer_pb28_import_rows(uuid,jsonb) to authenticated;
commit;
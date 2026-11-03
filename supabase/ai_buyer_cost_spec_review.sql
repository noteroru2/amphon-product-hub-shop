begin;
-- Owner-reviewed normalization of legacy inventory titles, isolated from original accounting and PriceBook.
create table if not exists public.ai_buyer_cost_spec_reviews (
 id bigint generated always as identity primary key,
 source_kind text not null default 'INVENTORY' check (source_kind='INVENTORY'),
 source_key text not null,
 source_name_snapshot text not null,
 source_category_snapshot text not null,
 reviewed_name text not null check (length(btrim(reviewed_name)) between 3 and 300),
 reviewed_category text not null check (reviewed_category in
  ('NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER')),
 review_note text not null default '' check (length(review_note)<=800),
 reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(),
 unique(source_kind,source_key),
 foreign key(source_kind,source_key) references public.ai_buyer_cost_history(source_kind,source_key)
);
create index if not exists ai_buyer_cost_spec_reviews_reviewer on public.ai_buyer_cost_spec_reviews(reviewed_by);
create table if not exists public.ai_buyer_cost_spec_review_audit (
 id bigint generated always as identity primary key,
 source_kind text not null,
 source_key text not null,
 actor_id uuid not null references auth.users(id),
 action text not null check (action in ('VERIFY','REVISE','REVOKE')),
 before_data jsonb,
 after_data jsonb,
 changed_at timestamptz not null default now()
);
create index if not exists ai_buyer_cost_spec_review_audit_source on public.ai_buyer_cost_spec_review_audit(source_kind,source_key,changed_at desc);
create index if not exists ai_buyer_cost_spec_review_audit_actor on public.ai_buyer_cost_spec_review_audit(actor_id);
alter table public.ai_buyer_cost_spec_reviews enable row level security;
alter table public.ai_buyer_cost_spec_review_audit enable row level security;
revoke all on public.ai_buyer_cost_spec_reviews, public.ai_buyer_cost_spec_review_audit from public,anon,authenticated;
grant select on public.ai_buyer_cost_spec_reviews, public.ai_buyer_cost_spec_review_audit to authenticated;
drop policy if exists cost_reviews_owner_read on public.ai_buyer_cost_spec_reviews;
drop policy if exists cost_reviews_owner_read on public.ai_buyer_cost_spec_review_audit;
create policy cost_reviews_owner_read on public.ai_buyer_cost_spec_reviews for select to authenticated
 using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));
create policy cost_reviews_owner_read on public.ai_buyer_cost_spec_review_audit for select to authenticated
 using (exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role in ('owner','admin')));

create or replace function public.ai_buyer_cost_spec_review_save(
 p_source_key text,p_source_name text,p_source_category text,
 p_reviewed_name text,p_reviewed_category text,p_note text default ''
) returns bigint
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous jsonb; result_id bigint;
 current_row public.ai_buyer_cost_history%rowtype;
begin
 if actor is null or not exists (select 1 from public.profiles p
   where p.id=actor and p.active and p.role in ('owner','admin'))
 then raise exception 'COST_REVIEW_OWNER_REQUIRED' using errcode='42501'; end if;
 if p_source_key is null or length(p_source_key) not between 1 and 100 or
    p_reviewed_name is null or length(btrim(p_reviewed_name)) not between 3 and 300 or
    p_reviewed_category not in ('NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER') or
    length(coalesce(p_note,''))>800
 then raise exception 'COST_REVIEW_INPUT_INVALID';end if;
 select * into current_row from public.ai_buyer_cost_history
 where source_kind='INVENTORY' and source_key=p_source_key for share;
 if not found then raise exception 'COST_REVIEW_SOURCE_MISSING';end if;
 if current_row.product_name is distinct from p_source_name or current_row.category is distinct from p_source_category
 then raise exception 'COST_REVIEW_SOURCE_CHANGED';end if;
 select to_jsonb(r) into previous from public.ai_buyer_cost_spec_reviews r
  where r.source_kind='INVENTORY' and r.source_key=p_source_key for update;
 insert into public.ai_buyer_cost_spec_reviews(
  source_kind,source_key,source_name_snapshot,source_category_snapshot,reviewed_name,
  reviewed_category,review_note,reviewed_by,reviewed_at
 ) values ('INVENTORY',p_source_key,current_row.product_name,current_row.category,
    btrim(p_reviewed_name),p_reviewed_category,coalesce(p_note,''),actor,now())
 on conflict (source_kind,source_key) do update set
  source_name_snapshot=excluded.source_name_snapshot,
  source_category_snapshot=excluded.source_category_snapshot,
  reviewed_name=excluded.reviewed_name,
  reviewed_category=excluded.reviewed_category,
  review_note=excluded.review_note,
  reviewed_by=excluded.reviewed_by,reviewed_at=now()
 returning id into result_id;
 insert into public.ai_buyer_cost_spec_review_audit(source_kind,source_key,actor_id,action,before_data,after_data)
 select 'INVENTORY',p_source_key,actor,case when previous is null then 'VERIFY' else 'REVISE' end,
    previous,to_jsonb(r)
 from public.ai_buyer_cost_spec_reviews r where r.id=result_id;
 return result_id;
end;$$;

create or replace function public.ai_buyer_cost_spec_review_revoke(p_source_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old jsonb;
begin
 if actor is null or not exists(select 1 from public.profiles p
   where p.id=actor and p.active and p.role in ('owner','admin'))
 then raise exception 'COST_REVIEW_OWNER_REQUIRED' using errcode='42501';end if;
 select to_jsonb(r) into old from public.ai_buyer_cost_spec_reviews r
 where r.source_kind='INVENTORY' and r.source_key=p_source_key for update;
 if old is null then raise exception 'COST_REVIEW_NOT_FOUND';end if;
 delete from public.ai_buyer_cost_spec_reviews
 where source_kind='INVENTORY' and source_key=p_source_key;
 insert into public.ai_buyer_cost_spec_review_audit(source_kind,source_key,actor_id,action,before_data)
 values('INVENTORY',p_source_key,actor,'REVOKE',old);
 return true;
end;$$;
revoke all on function public.ai_buyer_cost_spec_review_save(text,text,text,text,text,text) from public,anon;
revoke all on function public.ai_buyer_cost_spec_review_revoke(text) from public,anon;
grant execute on function public.ai_buyer_cost_spec_review_save(text,text,text,text,text,text) to authenticated;
grant execute on function public.ai_buyer_cost_spec_review_revoke(text) to authenticated;
commit;
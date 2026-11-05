begin;
create table if not exists public.ai_buyer_office_notebook_rule_batches(
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id),
 title text not null check(length(btrim(title)) between 5 and 200),
 rules jsonb not null check(jsonb_typeof(rules)='array' and jsonb_array_length(rules) between 1 and 80),
 analysis_note text not null default '' check(length(analysis_note)<=3000),
 source_label text not null default 'CHATGPT_ASSISTED' check(source_label='CHATGPT_ASSISTED'),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED_DRAFT','DISMISSED')),
 approved_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.ai_buyer_office_notebook_rule_audit(
 id bigint generated always as identity primary key,
 batch_id uuid not null references public.ai_buyer_office_notebook_rule_batches(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('APPROVE_DRAFT','DISMISS')),
 before_data jsonb not null,after_data jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists ai_buyer_office_notebook_rule_batch_status_created
 on public.ai_buyer_office_notebook_rule_batches(status,created_at desc);
alter table public.ai_buyer_office_notebook_rule_batches enable row level security;
alter table public.ai_buyer_office_notebook_rule_audit enable row level security;
revoke all on public.ai_buyer_office_notebook_rule_batches,public.ai_buyer_office_notebook_rule_audit from public,anon,authenticated;
grant select on public.ai_buyer_office_notebook_rule_batches,public.ai_buyer_office_notebook_rule_audit to authenticated;
drop policy if exists office_notebook_rule_owner on public.ai_buyer_office_notebook_rule_batches;
drop policy if exists office_notebook_rule_audit_owner on public.ai_buyer_office_notebook_rule_audit;
create policy office_notebook_rule_owner on public.ai_buyer_office_notebook_rule_batches
 for select to authenticated using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));
create policy office_notebook_rule_audit_owner on public.ai_buyer_office_notebook_rule_audit
 for select to authenticated using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));
create or replace function public.ai_buyer_office_notebook_rule_decide(p_batch_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); oldrow public.ai_buyer_office_notebook_rule_batches%rowtype;
 newrow public.ai_buyer_office_notebook_rule_batches%rowtype;
 item jsonb; identities text[]:='{}'; key text; vmin numeric; vmax numeric;
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role='owner')
 then raise exception 'OFFICE_NOTEBOOK_OWNER_REQUIRED' using errcode='42501';end if;
 if p_action not in ('APPROVE_DRAFT','DISMISS') then raise exception 'OFFICE_NOTEBOOK_ACTION_INVALID';end if;
 select * into oldrow from public.ai_buyer_office_notebook_rule_batches where id=p_batch_id for update;
 if not found or oldrow.status<>'PENDING' then raise exception 'OFFICE_NOTEBOOK_NOT_PENDING';end if;
 if p_action='APPROVE_DRAFT' then
  if not exists(select 1 from public.ai_buyer_pb28_drafts d where d.id=oldrow.draft_id and d.status='DRAFT')
  then raise exception 'OFFICE_NOTEBOOK_DRAFT_NOT_EDITABLE';end if;
  for item in select value from jsonb_array_elements(oldrow.rules) loop
   if jsonb_typeof(item)<>'object' or item->>'category'<>'NOTEBOOK_GENERAL' or
      length(btrim(coalesce(item->>'key',''))) not between 3 and 90 or
      length(btrim(coalesce(item->>'cpu',''))) not between 3 and 100 or
      item->>'condition_key'<>'NORMAL' or item->>'gpu'<>'INTEGRATED_ONLY'
   then raise exception 'OFFICE_NOTEBOOK_RULE_BAD_SPEC';end if;
   key:=item->>'key';if key=any(identities) then raise exception 'OFFICE_NOTEBOOK_DUPLICATE';end if;
   identities:=array_append(identities,key);
   if item->>'review_type'='PER_MODEL' then
    if item->'opening_min' <> 'null'::jsonb or item->'opening_max' <> 'null'::jsonb
    then raise exception 'OFFICE_NOTEBOOK_PER_MODEL_MUST_BE_NULL';end if;
   elsif item->>'review_type'='RANGE' then
    if jsonb_typeof(item->'opening_min')<>'number' or jsonb_typeof(item->'opening_max')<>'number'
    then raise exception 'OFFICE_NOTEBOOK_PRICE_REQUIRED';end if;
    vmin:=(item->>'opening_min')::numeric;vmax:=(item->>'opening_max')::numeric;
    if vmin<0 or vmax<vmin or vmax>1000000 then raise exception 'OFFICE_NOTEBOOK_BAD_RANGE';end if;
   else raise exception 'OFFICE_NOTEBOOK_REVIEW_TYPE_INVALID';
   end if;
  end loop;
 end if;
 update public.ai_buyer_office_notebook_rule_batches
 set status=case when p_action='APPROVE_DRAFT' then 'APPROVED_DRAFT' else 'DISMISSED' end,
 approved_by=actor,reviewed_at=now() where id=p_batch_id returning * into newrow;
 insert into public.ai_buyer_office_notebook_rule_audit(batch_id,actor_id,action,before_data,after_data)
 values(p_batch_id,actor,p_action,to_jsonb(oldrow),to_jsonb(newrow));
 return newrow.status;
end;$$;
revoke all on function public.ai_buyer_office_notebook_rule_decide(uuid,text) from public,anon;
grant execute on function public.ai_buyer_office_notebook_rule_decide(uuid,text) to authenticated;
commit;
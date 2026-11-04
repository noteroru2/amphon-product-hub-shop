begin;
-- Purely administrative owner-reviewed price-policy proposal, never read by LINE Worker.
create table if not exists public.ai_buyer_notebook_rule_batches(
 id uuid primary key default gen_random_uuid(),
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id),
 title text not null check(length(btrim(title)) between 4 and 200),
 rules jsonb not null check(
   jsonb_typeof(rules)='array' and
   jsonb_array_length(rules) between 1 and 20),
 source_label text not null default 'CHATGPT_ASSISTED' check(source_label='CHATGPT_ASSISTED'),
 analysis_note text not null default '' check(length(analysis_note)<=3000),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED_DRAFT','DISMISSED')),
 approved_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists ai_buyer_notebook_rule_batches_created on public.ai_buyer_notebook_rule_batches(status,created_at desc);
create table if not exists public.ai_buyer_notebook_rule_audit (
 id bigint generated always as identity primary key,
 batch_id uuid not null references public.ai_buyer_notebook_rule_batches(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('APPROVE_DRAFT','DISMISS')),
 before_data jsonb not null,
 after_data jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.ai_buyer_notebook_rule_batches enable row level security;
alter table public.ai_buyer_notebook_rule_audit enable row level security;
revoke all on public.ai_buyer_notebook_rule_batches,public.ai_buyer_notebook_rule_audit from public,anon,authenticated;
grant select on public.ai_buyer_notebook_rule_batches,public.ai_buyer_notebook_rule_audit to authenticated;
drop policy if exists notebook_rule_batches_owner_read on public.ai_buyer_notebook_rule_batches;
drop policy if exists notebook_rule_audit_owner_read on public.ai_buyer_notebook_rule_audit;
create policy notebook_rule_batches_owner_read on public.ai_buyer_notebook_rule_batches
 for select to authenticated using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));
create policy notebook_rule_audit_owner_read on public.ai_buyer_notebook_rule_audit
 for select to authenticated using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));

create or replace function public.ai_buyer_notebook_rule_decide(p_batch_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); rec public.ai_buyer_notebook_rule_batches%rowtype;
 newrow public.ai_buyer_notebook_rule_batches%rowtype; row_data jsonb; n integer; seen text[]:='{}';
 lower_amount numeric; upper_amount numeric; key text;
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role='owner')
 then raise exception 'NOTEBOOK_RULE_OWNER_REQUIRED' using errcode='42501';end if;
 if p_action not in ('APPROVE_DRAFT','DISMISS') then raise exception 'NOTEBOOK_RULE_ACTION_INVALID';end if;
 select * into rec from public.ai_buyer_notebook_rule_batches where id=p_batch_id for update;
 if not found or rec.status<>'PENDING' then raise exception 'NOTEBOOK_RULE_NOT_PENDING';end if;
 if p_action='APPROVE_DRAFT' then
  perform 1 from public.ai_buyer_pb28_drafts where id=rec.draft_id and status='DRAFT';
  if not found then raise exception 'NOTEBOOK_RULE_DRAFT_NOT_EDITABLE';end if;
  for row_data in select value from pg_catalog.jsonb_array_elements(rec.rules) loop
   if pg_catalog.jsonb_typeof(row_data)<>'object' or length(btrim(coalesce(row_data->>'key',''))) not between 3 and 80
    or length(btrim(coalesce(row_data->>'spec',''))) not between 5 and 250
    or (row_data->>'opening_min') is null or (row_data->>'opening_max') is null
    or row_data->>'category'<>'NOTEBOOK_GAMING'
   then raise exception 'NOTEBOOK_RULE_INVALID_ITEM';end if;
   key:=btrim(row_data->>'key');
   if key=any(seen) then raise exception 'NOTEBOOK_RULE_DUPLICATE_KEY';end if;
   seen:=array_append(seen,key);
   lower_amount:=(row_data->>'opening_min')::numeric;
   upper_amount:=(row_data->>'opening_max')::numeric;
   if lower_amount<0 or lower_amount>upper_amount or upper_amount>1000000
   then raise exception 'NOTEBOOK_RULE_INVALID_PRICE';end if;
  end loop;
 end if;
 update public.ai_buyer_notebook_rule_batches set
  status=case when p_action='APPROVE_DRAFT' then 'APPROVED_DRAFT' else 'DISMISSED' end,
  approved_by=actor,reviewed_at=now() where id=p_batch_id returning * into newrow;
 insert into public.ai_buyer_notebook_rule_audit(batch_id,actor_id,action,before_data,after_data)
 values(p_batch_id,actor,p_action,to_jsonb(rec),to_jsonb(newrow));
 return newrow.status;
end;$$;
revoke all on function public.ai_buyer_notebook_rule_decide(uuid,text) from public,anon;
grant execute on function public.ai_buyer_notebook_rule_decide(uuid,text) to authenticated;
commit;
begin;
create table if not exists public.ai_buyer_chat_price_inbox(
 id uuid primary key default gen_random_uuid(),
 draft_id uuid references public.ai_buyer_pb28_drafts(id),
 proposed_json jsonb not null check (jsonb_typeof(proposed_json)='object' and proposed_json->>'version'='1'
 and jsonb_typeof(proposed_json->'items')='array' and jsonb_array_length(proposed_json->'items') between 1 and 20),
 instruction text not null default '' check (length(instruction)<=2000),
 source_label text not null default 'CHATGPT_ASSISTED' check(source_label='CHATGPT_ASSISTED'),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','DISMISSED')),
 approved_by uuid references auth.users(id),
 approved_batch_id uuid references public.ai_buyer_chat_price_batches(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists ai_buyer_chat_price_inbox_status_created on public.ai_buyer_chat_price_inbox(status,created_at desc);
alter table public.ai_buyer_chat_price_inbox enable row level security;
revoke all on public.ai_buyer_chat_price_inbox from public,anon,authenticated;
grant select on public.ai_buyer_chat_price_inbox to authenticated;
drop policy if exists ai_buyer_chat_price_inbox_owner_read on public.ai_buyer_chat_price_inbox;
create policy ai_buyer_chat_price_inbox_owner_read on public.ai_buyer_chat_price_inbox for select to authenticated
 using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));

create or replace function public.ai_buyer_chat_price_apply_inbox(
 p_inbox_id uuid,p_draft_id uuid,p_items jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); inbox public.ai_buyer_chat_price_inbox%rowtype;
 expected_item jsonb; expected_field text; supplied_item jsonb; matches int;
 batch_id uuid;
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role='owner')
 then raise exception 'CHAT_PRICE_OWNER_REQUIRED' using errcode='42501';end if;
 select * into inbox from public.ai_buyer_chat_price_inbox where id=p_inbox_id for update;
 if not found or inbox.status<>'PENDING' then raise exception 'CHAT_PRICE_INBOX_NOT_PENDING';end if;
 if inbox.draft_id is not null and inbox.draft_id<>p_draft_id then raise exception 'CHAT_PRICE_INBOX_WRONG_DRAFT';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<>jsonb_array_length(inbox.proposed_json->'items')
 then raise exception 'CHAT_PRICE_INBOX_ITEMS_MISMATCH';end if;
 for expected_item in select value from jsonb_array_elements(inbox.proposed_json->'items') loop
  matches:=0;
  for supplied_item in select value from jsonb_array_elements(p_items) loop
   if lower(btrim(coalesce(supplied_item->>'model','')))<>lower(btrim(coalesce(expected_item->>'model','')))
   then continue;end if;
   if exists(select 1 from jsonb_object_keys(expected_item) as k
      where k not in ('model','note','category','brand','model_code','condition_key','estimated_resale','opening_offer','target_buy','hard_max'))
   then raise exception 'CHAT_PRICE_INBOX_UNEXPECTED_FIELD';end if;
   if exists(select 1 from jsonb_object_keys(expected_item) as k
    where k <> 'note' and (
     case when k in ('estimated_resale','opening_offer','target_buy','hard_max')
       then coalesce((supplied_item->>k)::numeric,(-1)::numeric) is distinct from coalesce((expected_item->>k)::numeric,(-1)::numeric)
       else coalesce(supplied_item->>k,'') is distinct from coalesce(expected_item->>k,'')
     end)
   )then continue;end if;
   matches:=matches+1;
  end loop;
  if matches<>1 then raise exception 'CHAT_PRICE_INBOX_PROPOSAL_CHANGED';end if;
 end loop;
 batch_id:=public.ai_buyer_chat_price_apply(p_draft_id,p_items,inbox.instruction);
 update public.ai_buyer_chat_price_inbox set status='APPROVED',approved_by=actor,
 approved_batch_id=batch_id,reviewed_at=now() where id=p_inbox_id;
 return batch_id;
end;$$;

create or replace function public.ai_buyer_chat_price_dismiss_inbox(p_inbox_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role='owner')
 then raise exception 'CHAT_PRICE_OWNER_REQUIRED' using errcode='42501';end if;
 update public.ai_buyer_chat_price_inbox set status='DISMISSED',approved_by=actor,reviewed_at=now()
 where id=p_inbox_id and status='PENDING';
 if not found then raise exception 'CHAT_PRICE_INBOX_NOT_PENDING';end if;
 return true;
end;$$;
revoke all on function public.ai_buyer_chat_price_apply_inbox(uuid,uuid,jsonb) from public,anon;
revoke all on function public.ai_buyer_chat_price_dismiss_inbox(uuid) from public,anon;
grant execute on function public.ai_buyer_chat_price_apply_inbox(uuid,uuid,jsonb) to authenticated;
grant execute on function public.ai_buyer_chat_price_dismiss_inbox(uuid) to authenticated;
commit;
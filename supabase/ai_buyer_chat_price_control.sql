begin;
-- Chat Price Control: chat can propose untrusted price changes; only logged-in Owner can approve.
-- Deliberately no public RPC for submitting from chat. The connected service/admin connector
-- creates *pending-only* proposals; it is never allowed to impersonate an Owner approval.
create table if not exists public.ai_buyer_chat_price_proposals (
 id uuid primary key default gen_random_uuid(),
 batch_id uuid not null default gen_random_uuid(),
 draft_id uuid not null references public.ai_buyer_pb28_drafts(id),
 entry_id uuid not null references public.ai_buyer_pb28_entries(id),
 request_origin text not null default 'CHATGPT_CONNECTOR'
  check(request_origin in ('CHATGPT_CONNECTOR','HUB_OWNER')),
 summary text not null default '' check(length(summary)<=500),
 reason text not null default '' check(length(reason)<=800),
 expected_entry_updated_at timestamptz not null,
 before_snapshot jsonb not null check(jsonb_typeof(before_snapshot)='object'),
 proposed_prices jsonb not null check(jsonb_typeof(proposed_prices)='object'),
 preview_hash text generated always as (
   md5(draft_id::text || ':' || entry_id::text || ':' ||
       expected_entry_updated_at::text || ':' ||
       before_snapshot::text || ':' || proposed_prices::text)
 ) stored,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '48 hours'),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 constraint chat_price_expiry_chk check(expires_at>created_at),
 constraint chat_price_approval_chk check(
   (status='PENDING' and reviewed_by is null and reviewed_at is null)
    or (status<>'PENDING' and reviewed_by is not null and reviewed_at is not null)
 )
);
create index if not exists ai_buyer_chat_price_pending_idx
 on public.ai_buyer_chat_price_proposals(status,created_at desc);
create index if not exists ai_buyer_chat_price_batch_idx on public.ai_buyer_chat_price_proposals(batch_id);
create index if not exists ai_buyer_chat_price_draft_idx on public.ai_buyer_chat_price_proposals(draft_id,created_at desc);

create table if not exists public.ai_buyer_chat_price_audit (
 id bigint generated always as identity primary key,
 proposal_id uuid not null references public.ai_buyer_chat_price_proposals(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('APPROVE','REJECT')),
 before_data jsonb not null,
 after_data jsonb not null,
 recorded_at timestamptz not null default now()
);
create index if not exists ai_buyer_chat_price_audit_proposal_idx
 on public.ai_buyer_chat_price_audit(proposal_id,recorded_at desc);
alter table public.ai_buyer_chat_price_proposals enable row level security;
alter table public.ai_buyer_chat_price_audit enable row level security;
revoke all on public.ai_buyer_chat_price_proposals,public.ai_buyer_chat_price_audit
 from public,anon,authenticated;
grant select on public.ai_buyer_chat_price_proposals,public.ai_buyer_chat_price_audit to authenticated;
drop policy if exists chat_price_owner_read on public.ai_buyer_chat_price_proposals;
drop policy if exists chat_price_owner_read on public.ai_buyer_chat_price_audit;
create policy chat_price_owner_read on public.ai_buyer_chat_price_proposals for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid())
   and p.active and p.role='owner'));
create policy chat_price_owner_read on public.ai_buyer_chat_price_audit for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid())
   and p.active and p.role='owner'));

create or replace function public.ai_buyer_chat_price_decide(
 p_proposal_id uuid,p_action text,p_preview_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid();
 req public.ai_buyer_chat_price_proposals%rowtype;
 draft public.ai_buyer_pb28_drafts%rowtype;
 entry public.ai_buyer_pb28_entries%rowtype;
 before_entry jsonb; after_entry jsonb;
 n_resale numeric; n_opening numeric; n_target numeric; n_max numeric;
 review_snapshot jsonb;
begin
 -- Only an authenticated Owner (not Admin/Sales/service-role) can approve/reject.
 if actor is null or not exists(select 1 from public.profiles p
  where p.id=actor and p.active and p.role='owner') then
  raise exception 'CHAT_PRICE_OWNER_REQUIRED' using errcode='42501';
 end if;
 if p_action not in ('APPROVE','REJECT') then
  raise exception 'CHAT_PRICE_ACTION_INVALID';
 end if;
 select * into req from public.ai_buyer_chat_price_proposals
  where id=p_proposal_id for update;
 if not found then raise exception 'CHAT_PRICE_NOT_FOUND'; end if;
 if req.status<>'PENDING' then raise exception 'CHAT_PRICE_ALREADY_DECIDED'; end if;
 if req.expires_at<=now() then raise exception 'CHAT_PRICE_EXPIRED'; end if;
 if p_preview_hash is distinct from req.preview_hash then
  raise exception 'CHAT_PRICE_PREVIEW_CHANGED';
 end if;
 select * into draft from public.ai_buyer_pb28_drafts
  where id=req.draft_id for update;
 if not found or draft.status<>'DRAFT' then
  raise exception 'CHAT_PRICE_DRAFT_NOT_EDITABLE';
 end if;
 select * into entry from public.ai_buyer_pb28_entries
  where id=req.entry_id and draft_id=req.draft_id for update;
 if not found then raise exception 'CHAT_PRICE_ENTRY_MISSING'; end if;
 before_entry:=to_jsonb(entry);
 if entry.updated_at is distinct from req.expected_entry_updated_at or
    before_entry is distinct from req.before_snapshot then
  raise exception 'CHAT_PRICE_STALE_BASELINE';
 end if;
 if p_action='APPROVE' then
   if jsonb_object_length(req.proposed_prices)<>4 or
      not (req.proposed_prices ?& array['estimated_resale','opening_offer','target_buy','hard_max']) then
     raise exception 'CHAT_PRICE_PRICE_FIELDS_INVALID';
   end if;
   begin
     n_resale:=(req.proposed_prices->>'estimated_resale')::numeric;
     n_opening:=(req.proposed_prices->>'opening_offer')::numeric;
     n_target:=(req.proposed_prices->>'target_buy')::numeric;
     n_max:=(req.proposed_prices->>'hard_max')::numeric;
   exception when invalid_text_representation or numeric_value_out_of_range then
     raise exception 'CHAT_PRICE_AMOUNTS_INVALID';
   end;
   if n_resale is null or n_opening is null or n_target is null or n_max is null or
     n_resale<=0 or n_opening<0 or n_opening>n_target or n_target>n_max or
     n_max>n_resale or n_resale>10000000 or
     n_resale=entry.estimated_resale and n_opening=entry.opening_offer and
     n_target=entry.target_buy and n_max=entry.hard_max then
       raise exception 'CHAT_PRICE_PRICE_ORDER_OR_NO_CHANGE';
   end if;
   -- Preserve ALL existing entry identity/aliases/specs/active/note and update only 4 prices.
   update public.ai_buyer_pb28_entries set
     estimated_resale=n_resale,opening_offer=n_opening,target_buy=n_target,
     hard_max=n_max,updated_at=now()
    where id=req.entry_id and draft_id=req.draft_id
    returning to_jsonb(public.ai_buyer_pb28_entries.*) into after_entry;
   insert into public.ai_buyer_pb28_audit(draft_id,entry_id,actor_id,action,before_data,after_data)
     values(req.draft_id,req.entry_id,actor,'UPDATE_ENTRY',before_entry,
      after_entry||jsonb_build_object('chat_price_proposal_id',req.id,'channel','CHAT_PRICE_CONTROL'));
   update public.ai_buyer_pb28_drafts set updated_at=now() where id=req.draft_id;
 else
   after_entry:=before_entry;
 end if;
 review_snapshot:=to_jsonb(req);
 update public.ai_buyer_chat_price_proposals set status=
  case when p_action='APPROVE' then 'APPROVED' else 'REJECTED' end,
  reviewed_by=actor,reviewed_at=now()
  where id=req.id;
 insert into public.ai_buyer_chat_price_audit(proposal_id,actor_id,action,before_data,after_data)
  values(req.id,actor,p_action,review_snapshot,
    jsonb_build_object('proposal_id',req.id,'draft_id',req.draft_id,'entry_id',req.entry_id,
      'status',case when p_action='APPROVE' then 'APPROVED' else 'REJECTED' end,
      'before_entry',before_entry,'after_entry',after_entry));
 return jsonb_build_object('proposal_id',req.id,
   'status',case when p_action='APPROVE' then 'APPROVED' else 'REJECTED' end,
   'entry_id',req.entry_id,'draft_id',req.draft_id);
end;$$;

revoke all on function public.ai_buyer_chat_price_decide(uuid,text,text) from public,anon;
grant execute on function public.ai_buyer_chat_price_decide(uuid,text,text) to authenticated;
commit;
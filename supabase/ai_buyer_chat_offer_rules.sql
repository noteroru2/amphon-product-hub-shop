begin;
create table if not exists public.ai_buyer_chat_offer_rules (
 id uuid primary key default gen_random_uuid(),
 draft_id uuid references public.ai_buyer_pb28_drafts(id),
 title text not null check (length(btrim(title)) between 5 and 200),
 category text not null check(category='NOTEBOOK_GAMING'),
 cpu_family text not null check(cpu_family='INTEL_CORE_I5'),
 cpu_generation integer not null check(cpu_generation between 1 and 30),
 gpu_model text not null check(gpu_model='GTX1650'),
 ram_options integer[] not null check(ram_options=array[8,16]::integer[]),
 ssd_gb integer not null check(ssd_gb=512),
 opening_min numeric(12,2) not null check(opening_min>=0),
 opening_max numeric(12,2) not null check(opening_max>=opening_min),
 exclude_gpu_variants text[] not null default array['GTX1650TI']::text[],
 require_functional boolean not null default true check(require_functional=true),
 description text not null default '' check(length(description)<=1000),
 source_label text not null default 'CHATGPT_ASSISTED',
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED_DRAFT','DISMISSED')),
 approved_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists ai_buyer_chat_offer_rules_status on public.ai_buyer_chat_offer_rules(status,created_at desc);
alter table public.ai_buyer_chat_offer_rules enable row level security;
revoke all on public.ai_buyer_chat_offer_rules from public,anon,authenticated;
grant select on public.ai_buyer_chat_offer_rules to authenticated;
drop policy if exists chat_offer_rule_owner_select on public.ai_buyer_chat_offer_rules;
create policy chat_offer_rule_owner_select on public.ai_buyer_chat_offer_rules for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active and p.role='owner'));

create or replace function public.ai_buyer_chat_offer_rule_decide(p_rule_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec public.ai_buyer_chat_offer_rules%rowtype;
begin
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.active and p.role='owner')
 then raise exception 'CHAT_OFFER_OWNER_REQUIRED' using errcode='42501';end if;
 if p_action not in ('APPROVE_DRAFT','DISMISS') then raise exception 'CHAT_OFFER_ACTION_INVALID';end if;
 select * into rec from public.ai_buyer_chat_offer_rules where id=p_rule_id for update;
 if not found or rec.status<>'PENDING' then raise exception 'CHAT_OFFER_RULE_NOT_PENDING';end if;
 if p_action='APPROVE_DRAFT' and rec.draft_id is not null and not exists(
  select 1 from public.ai_buyer_pb28_drafts d where d.id=rec.draft_id and d.status='DRAFT'
 ) then raise exception 'CHAT_OFFER_DRAFT_NOT_EDITABLE';end if;
 update public.ai_buyer_chat_offer_rules
 set status=case when p_action='APPROVE_DRAFT' then 'APPROVED_DRAFT' else 'DISMISSED' end,
 approved_by=actor,reviewed_at=now() where id=p_rule_id;
 return case when p_action='APPROVE_DRAFT' then 'APPROVED_DRAFT' else 'DISMISSED' end;
end;$$;
revoke all on function public.ai_buyer_chat_offer_rule_decide(uuid,text) from public,anon;
grant execute on function public.ai_buyer_chat_offer_rule_decide(uuid,text) to authenticated;
commit;
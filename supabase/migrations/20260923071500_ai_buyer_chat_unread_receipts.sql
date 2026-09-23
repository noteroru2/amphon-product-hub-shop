-- Per-admin read receipts for LINE OA Chat.
-- Existing inbound messages are unread until that admin opens the conversation.

create table if not exists public.ai_buyer_chat_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_read_message_id uuid null references public.ai_buyer_messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id,case_id)
);

create index if not exists ai_buyer_chat_reads_case_idx
  on public.ai_buyer_chat_reads(case_id,user_id);

alter table public.ai_buyer_chat_reads enable row level security;
revoke all on public.ai_buyer_chat_reads from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_chat_reads to service_role;

create or replace function public.ai_buyer_chat_mark_read(
  p_user_id uuid,
  p_case_id uuid
)
returns table (
  unread_count integer,
  last_read_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_message_id uuid;
  v_read_at timestamptz;
begin
  select m.id,coalesce(m.line_timestamp,m.created_at)
  into v_message_id,v_read_at
  from public.ai_buyer_messages m
  where m.case_id=p_case_id
    and m.direction='INBOUND'
  order by coalesce(m.line_timestamp,m.created_at) desc,m.created_at desc
  limit 1;

  v_read_at := coalesce(v_read_at,now());

  insert into public.ai_buyer_chat_reads(
    user_id,case_id,last_read_at,last_read_message_id,updated_at
  )
  values (
    p_user_id,p_case_id,v_read_at,v_message_id,now()
  )
  on conflict (user_id,case_id)
  do update set
    last_read_at=greatest(public.ai_buyer_chat_reads.last_read_at,excluded.last_read_at),
    last_read_message_id=excluded.last_read_message_id,
    updated_at=now();

  return query
  select
    count(*)::int,
    r.last_read_at
  from public.ai_buyer_chat_reads r
  left join public.ai_buyer_messages m
    on m.case_id=p_case_id
   and m.direction='INBOUND'
   and coalesce(m.line_timestamp,m.created_at)>r.last_read_at
  where r.user_id=p_user_id
    and r.case_id=p_case_id
  group by r.last_read_at;
end;
$$;

revoke all on function public.ai_buyer_chat_mark_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_buyer_chat_mark_read(uuid,uuid) to service_role;

create or replace function public.ai_buyer_chat_list_for_user(
  p_user_id uuid,
  p_limit integer default 120
)
returns table (
  case_id uuid,
  conversation_id uuid,
  customer_id uuid,
  state text,
  category text,
  title text,
  control_mode text,
  updated_at timestamptz,
  display_name text,
  picture_url text,
  phone text,
  last_message_type text,
  last_message_text text,
  last_message_at timestamptz,
  image_count integer,
  latest_offer_amount numeric,
  latest_offer_status text,
  latest_offer_at timestamptz,
  last_activity_at timestamptz,
  unread_count integer
)
language sql
stable
security definer
set search_path=public
as $$
  select
    v.case_id,
    v.conversation_id,
    v.customer_id,
    v.state,
    v.category,
    v.title,
    v.control_mode,
    v.updated_at,
    v.display_name,
    v.picture_url,
    v.phone,
    v.last_message_type,
    v.last_message_text,
    v.last_message_at,
    v.image_count,
    v.latest_offer_amount,
    v.latest_offer_status,
    v.latest_offer_at,
    v.last_activity_at,
    coalesce(u.unread_count,0)::int
  from public.ai_buyer_chat_list_v v
  left join public.ai_buyer_chat_reads r
    on r.case_id=v.case_id
   and r.user_id=p_user_id
  left join lateral (
    select count(*)::int as unread_count
    from public.ai_buyer_messages m
    where m.case_id=v.case_id
      and m.direction='INBOUND'
      and coalesce(m.line_timestamp,m.created_at)>coalesce(r.last_read_at,'epoch'::timestamptz)
  ) u on true
  order by v.last_activity_at desc
  limit greatest(20,least(coalesce(p_limit,120),200));
$$;

revoke all on function public.ai_buyer_chat_list_for_user(uuid,integer) from public,anon,authenticated;
grant execute on function public.ai_buyer_chat_list_for_user(uuid,integer) to service_role;

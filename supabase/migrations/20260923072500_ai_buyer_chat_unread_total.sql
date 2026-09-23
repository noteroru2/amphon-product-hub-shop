-- Lightweight unread total for the Hub bottom navigation badge.

create or replace function public.ai_buyer_chat_unread_total(
  p_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(sum(u.unread_count),0)::int
  from public.ai_buyer_valuation_cases c
  left join public.ai_buyer_chat_reads r
    on r.case_id=c.id
   and r.user_id=p_user_id
  left join lateral (
    select count(*)::int as unread_count
    from public.ai_buyer_messages m
    where m.case_id=c.id
      and m.direction='INBOUND'
      and coalesce(m.line_timestamp,m.created_at)>coalesce(r.last_read_at,'epoch'::timestamptz)
  ) u on true;
$$;

revoke all on function public.ai_buyer_chat_unread_total(uuid) from public,anon,authenticated;
grant execute on function public.ai_buyer_chat_unread_total(uuid) to service_role;

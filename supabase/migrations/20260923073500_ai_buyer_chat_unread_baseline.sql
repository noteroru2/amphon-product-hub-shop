-- Initialize unread tracking without turning historical chat into hundreds of
-- unread badges. Existing inbound history becomes the baseline; only messages
-- arriving after this migration are considered unread.

insert into public.ai_buyer_chat_reads(
  user_id,case_id,last_read_at,last_read_message_id,updated_at
)
select
  p.id,
  c.id,
  coalesce(last_inbound.read_at,now()),
  last_inbound.message_id,
  now()
from public.profiles p
cross join public.ai_buyer_valuation_cases c
left join lateral (
  select
    m.id as message_id,
    coalesce(m.line_timestamp,m.created_at) as read_at
  from public.ai_buyer_messages m
  where m.case_id=c.id
    and m.direction='INBOUND'
  order by coalesce(m.line_timestamp,m.created_at) desc,m.created_at desc
  limit 1
) last_inbound on true
where p.active=true
  and p.role in ('owner','admin')
on conflict (user_id,case_id)
do update set
  last_read_at=greatest(
    public.ai_buyer_chat_reads.last_read_at,
    excluded.last_read_at
  ),
  last_read_message_id=coalesce(
    excluded.last_read_message_id,
    public.ai_buyer_chat_reads.last_read_message_id
  ),
  updated_at=now();

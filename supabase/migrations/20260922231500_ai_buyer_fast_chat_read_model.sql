-- Fast read model for LINE OA Chat. Avoids the heavy AI Buyer dashboard
-- (OpenAI spend, deal ledger, learning metrics) for normal chat use.

create index if not exists ai_buyer_cases_updated_idx
  on public.ai_buyer_valuation_cases (updated_at desc);

create or replace view public.ai_buyer_chat_list_v
with (security_invoker=false) as
select
  c.id as case_id,
  c.conversation_id,
  c.customer_id,
  c.state,
  c.category,
  c.title,
  c.control_mode,
  c.updated_at,
  cu.display_name,
  cu.picture_url,
  cu.phone,
  lm.message_type as last_message_type,
  lm.text_content as last_message_text,
  lm.created_at as last_message_at,
  coalesce(img.image_count,0)::int as image_count,
  off.amount as latest_offer_amount,
  off.status as latest_offer_status,
  off.created_at as latest_offer_at,
  greatest(
    c.updated_at,
    coalesce(lm.created_at,c.updated_at),
    coalesce(off.created_at,c.updated_at)
  ) as last_activity_at
from public.ai_buyer_valuation_cases c
join public.ai_buyer_customers cu on cu.id=c.customer_id
left join lateral (
  select m.message_type,m.text_content,m.created_at
  from public.ai_buyer_messages m
  where m.case_id=c.id
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select count(*)::int as image_count
  from public.ai_buyer_case_images i
  where i.case_id=c.id
) img on true
left join lateral (
  select o.amount,o.status,o.created_at
  from public.ai_buyer_offers o
  where o.case_id=c.id
    and o.actor in ('AI','ADMIN')
  order by o.created_at desc
  limit 1
) off on true;

revoke all on public.ai_buyer_chat_list_v from public,anon,authenticated;
grant select on public.ai_buyer_chat_list_v to service_role;

-- Continuous learning repair/guard.
-- Backfills any AI Buyer messages that fall inside currently CAPTURING windows
-- but were missed by the insert trigger. Future OWNER_MANUAL replies are already
-- classified by ai_buyer_capture_learning_message().

create or replace function public.ai_buyer_repair_continuous_learning()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before integer;
  v_after integer;
begin
  select count(*)::int into v_before
  from public.ai_buyer_learning_events e
  join public.ai_buyer_learning_windows w on w.id=e.window_id
  where w.status='CAPTURING';

  insert into public.ai_buyer_learning_events(
    window_id,source,source_external_id,conversation_id,case_id,
    direction,speaker,message_type,text_content,occurred_at,raw_payload,
    pii_redaction_status
  )
  select
    w.id,
    'AI_BUYER_MESSAGE',
    m.id::text,
    m.conversation_id,
    m.case_id,
    m.direction,
    case
      when m.direction='INBOUND' then 'CUSTOMER'
      when m.direction='OUTBOUND'
        and coalesce(m.metadata->>'source','')='OWNER_MANUAL'
        then 'OWNER_MANUAL'
      when m.direction='OUTBOUND'
        and coalesce(m.metadata->>'source','')='ADMIN_APPROVAL'
        then 'OWNER_APPROVED'
      when m.direction='OUTBOUND'
        and coalesce(m.metadata->>'source','') in ('AI','AI_BUYER','AUTOMATION')
        then 'AI_SYSTEM'
      when m.direction='OUTBOUND' then 'SHOP_OTHER'
      else 'UNKNOWN'
    end,
    m.message_type,
    m.text_content,
    coalesce(m.line_timestamp,m.created_at),
    jsonb_build_object(
      'line_message_id',m.line_message_id,
      'webhook_event_id',m.webhook_event_id,
      'metadata',coalesce(m.metadata,'{}'::jsonb),
      'repairedBy','ai_buyer_repair_continuous_learning'
    ),
    'PENDING'
  from public.ai_buyer_learning_windows w
  join public.ai_buyer_messages m
    on coalesce(m.line_timestamp,m.created_at) >= w.starts_at
   and coalesce(m.line_timestamp,m.created_at) < w.ends_at
  where w.status='CAPTURING'
  on conflict do nothing;

  select count(*)::int into v_after
  from public.ai_buyer_learning_events e
  join public.ai_buyer_learning_windows w on w.id=e.window_id
  where w.status='CAPTURING';

  return jsonb_build_object(
    'before',v_before,
    'after',v_after,
    'inserted',greatest(0,v_after-v_before),
    'ownerManualCurrentWindow',(
      select count(*)::int
      from public.ai_buyer_learning_events e
      join public.ai_buyer_learning_windows w on w.id=e.window_id
      where w.status='CAPTURING' and e.speaker='OWNER_MANUAL'
    )
  );
end;
$$;

revoke all on function public.ai_buyer_repair_continuous_learning()
from public,anon,authenticated;
grant execute on function public.ai_buyer_repair_continuous_learning()
to service_role;

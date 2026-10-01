-- Continuous Owner Manual capture hardening.
-- Guarantees Hub manual replies are attached to every matching CAPTURING window
-- and price offers become PRICE_QUOTE labels without depending on trigger order.

create or replace function public.ai_buyer_capture_owner_manual_learning()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  w record;
  v_at timestamptz;
  v_event_id uuid;
  v_offer numeric;
  v_action_id text;
begin
  if new.direction <> 'OUTBOUND'
     or coalesce(new.metadata->>'source','') <> 'OWNER_MANUAL'
  then
    return new;
  end if;

  v_at := coalesce(new.line_timestamp,new.created_at,now());
  v_offer := nullif(new.metadata->>'offerAmount','')::numeric;
  v_action_id := nullif(new.metadata->>'outboundActionId','');

  for w in
    select id
    from public.ai_buyer_learning_windows
    where status='CAPTURING'
      and v_at >= starts_at
      and v_at < ends_at
  loop
    insert into public.ai_buyer_learning_events(
      window_id,source,source_external_id,conversation_id,case_id,
      direction,speaker,message_type,text_content,occurred_at,raw_payload,
      pii_redaction_status
    ) values (
      w.id,
      'AI_BUYER_MESSAGE',
      new.id::text,
      new.conversation_id,
      new.case_id,
      new.direction,
      'OWNER_MANUAL',
      new.message_type,
      new.text_content,
      v_at,
      jsonb_build_object(
        'line_message_id',new.line_message_id,
        'webhook_event_id',new.webhook_event_id,
        'metadata',coalesce(new.metadata,'{}'::jsonb),
        'continuousCapture','OWNER_MANUAL_V2'
      ),
      'PENDING'
    )
    on conflict (window_id,source,source_external_id)
      where source_external_id is not null
    do update set
      speaker='OWNER_MANUAL',
      text_content=excluded.text_content,
      occurred_at=excluded.occurred_at,
      raw_payload=excluded.raw_payload
    returning id into v_event_id;

    if v_event_id is null then
      select id into v_event_id
      from public.ai_buyer_learning_events
      where window_id=w.id
        and source='AI_BUYER_MESSAGE'
        and source_external_id=new.id::text
      limit 1;
    end if;

    if v_offer is not null then
      insert into public.ai_buyer_learning_labels(
        window_id,conversation_id,case_id,label_type,payload,
        confidence,verified,source_event_ids,source_ref
      ) values (
        w.id,new.conversation_id,new.case_id,'PRICE_QUOTE',
        jsonb_build_object(
          'amount',v_offer,
          'actor','OWNER_MANUAL',
          'messageId',new.id,
          'outboundActionId',v_action_id,
          'sentAt',v_at,
          'capture','OWNER_MANUAL_V2'
        ),
        1.0,true,
        case when v_event_id is null then '{}'::uuid[] else array[v_event_id] end,
        case when v_action_id is not null
          then 'MANUAL_REPLY_PRICE:'||v_action_id
          else 'OWNER_MANUAL_MESSAGE_PRICE:'||new.id::text
        end
      )
      on conflict (window_id,label_type,source_ref)
        where source_ref is not null
      do update set
        payload=excluded.payload,
        verified=true,
        confidence=1.0,
        source_event_ids=excluded.source_event_ids;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.ai_buyer_capture_owner_manual_learning()
from public,anon,authenticated;
grant execute on function public.ai_buyer_capture_owner_manual_learning()
to service_role;

drop trigger if exists trg_ai_buyer_owner_manual_learning on public.ai_buyer_messages;
create trigger trg_ai_buyer_owner_manual_learning
after insert on public.ai_buyer_messages
for each row execute function public.ai_buyer_capture_owner_manual_learning();

create or replace function public.ai_buyer_backfill_owner_manual_continuous()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_events integer := 0;
  v_labels_before integer := 0;
  v_labels_after integer := 0;
begin
  with ins as (
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
      'OWNER_MANUAL',
      m.message_type,
      m.text_content,
      coalesce(m.line_timestamp,m.created_at),
      jsonb_build_object(
        'line_message_id',m.line_message_id,
        'webhook_event_id',m.webhook_event_id,
        'metadata',coalesce(m.metadata,'{}'::jsonb),
        'backfill','OWNER_MANUAL_V2'
      ),
      'PENDING'
    from public.ai_buyer_messages m
    join public.ai_buyer_learning_windows w
      on w.status in ('CAPTURING','CLOSED','PROCESSING','PROCESSED')
     and coalesce(m.line_timestamp,m.created_at) >= w.starts_at
     and coalesce(m.line_timestamp,m.created_at) < w.ends_at
    where m.direction='OUTBOUND'
      and coalesce(m.metadata->>'source','')='OWNER_MANUAL'
    on conflict (window_id,source,source_external_id)
      where source_external_id is not null
    do nothing
    returning 1
  )
  select count(*)::int into v_events from ins;

  select count(*)::int into v_labels_before
  from public.ai_buyer_learning_labels
  where label_type='PRICE_QUOTE';

  perform public.ai_buyer_backfill_owner_price_labels();

  select count(*)::int into v_labels_after
  from public.ai_buyer_learning_labels
  where label_type='PRICE_QUOTE';

  return jsonb_build_object(
    'ok',true,
    'eventsInserted',v_events,
    'priceLabelsInserted',greatest(0,v_labels_after-v_labels_before),
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.ai_buyer_backfill_owner_manual_continuous()
from public,anon,authenticated;
grant execute on function public.ai_buyer_backfill_owner_manual_continuous()
to service_role;

select public.ai_buyer_backfill_owner_manual_continuous();

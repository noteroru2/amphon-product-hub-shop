-- Manual reply archive fix: persist LINE sent-message id on ai_buyer_messages.

create or replace function public.ai_buyer_finalize_manual_reply(
  p_action_id uuid,
  p_line_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.ai_buyer_outbound_actions%rowtype;
  v_message_id uuid;
  v_offer_id uuid;
  v_decision record;
  v_offer_amount numeric;
  v_actor_user_id uuid;
  v_actor_name text;
  v_text text;
  v_round integer;
  w record;
begin
  select * into a
  from public.ai_buyer_outbound_actions
  where id=p_action_id and action_type='MANUAL_REPLY'
  for update;

  if a.id is null then
    raise exception 'MANUAL_REPLY_ACTION_NOT_FOUND';
  end if;

  if a.status='SENT' then
    select id into v_message_id
    from public.ai_buyer_messages
    where metadata->>'outboundActionId'=a.id::text
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'ok',true,'idempotent',true,'messageId',v_message_id,'actionId',a.id
    );
  end if;

  if a.status not in ('PENDING','FAILED') then
    raise exception 'MANUAL_REPLY_ACTION_NOT_SENDABLE';
  end if;

  v_text := a.payload->>'text';
  v_offer_amount := nullif(a.payload->>'offerAmount','')::numeric;
  v_actor_user_id := nullif(a.payload->>'actorUserId','')::uuid;
  v_actor_name := coalesce(a.payload->>'actorName','Owner');

  update public.ai_buyer_outbound_actions
  set status='SENT',
      line_message_id=nullif(trim(coalesce(p_line_message_id,'')),''),
      sent_at=now(),
      error=null,
      payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object('deliveredAt',now())
  where id=a.id;

  insert into public.ai_buyer_messages(
    conversation_id,case_id,line_message_id,direction,message_type,text_content,metadata,line_timestamp
  ) values (
    a.conversation_id,a.case_id,
    nullif(trim(coalesce(p_line_message_id,'')),''),
    'OUTBOUND','TEXT',v_text,
    jsonb_build_object(
      'source','OWNER_MANUAL',
      'actorUserId',v_actor_user_id,
      'actorName',v_actor_name,
      'offerAmount',v_offer_amount,
      'outboundActionId',a.id
    ),
    now()
  )
  returning id into v_message_id;

  if v_offer_amount is not null then
    select id,opening_offer,target_buy,hard_max,current_authorized_offer
    into v_decision
    from public.ai_buyer_pricing_decisions
    where case_id=a.case_id
    order by created_at desc
    limit 1;

    if v_decision.id is not null then
      select coalesce(max(round_no),0)+1 into v_round
      from public.ai_buyer_offers
      where case_id=a.case_id;

      insert into public.ai_buyer_offers(
        case_id,pricing_decision_id,amount,actor,status,message_id,round_no,delivered_at,
        idempotency_key
      ) values (
        a.case_id,v_decision.id,v_offer_amount,'ADMIN','PROPOSED',v_message_id,
        least(coalesce(v_round,1),20),now(),'MANUAL_REPLY:'||a.id::text
      )
      on conflict (idempotency_key) do update
        set delivered_at=coalesce(public.ai_buyer_offers.delivered_at,excluded.delivered_at)
      returning id into v_offer_id;

      insert into public.ai_buyer_human_overrides(
        case_id,pricing_decision_id,actor_user_id,ai_price,admin_price,reason_code,note
      ) values (
        a.case_id,v_decision.id,v_actor_user_id,
        v_decision.current_authorized_offer,v_offer_amount,
        'OWNER_MANUAL_QUOTE',
        'Manual LINE reply captured from Amphon Hub'
      );
    end if;

    for w in
      select distinct le.window_id
      from public.ai_buyer_learning_events le
      where le.case_id=a.case_id
    loop
      insert into public.ai_buyer_learning_labels(
        window_id,conversation_id,case_id,label_type,payload,confidence,verified,
        source_event_ids,source_ref
      ) values (
        w.window_id,a.conversation_id,a.case_id,'PRICE_QUOTE',
        jsonb_build_object(
          'amount',v_offer_amount,
          'actor','OWNER_MANUAL',
          'actorUserId',v_actor_user_id,
          'actorName',v_actor_name,
          'messageId',v_message_id,
          'offerId',v_offer_id,
          'sentAt',now()
        ),
        1.0,true,
        array[v_message_id],
        'MANUAL_REPLY_PRICE:'||a.id::text
      )
      on conflict (window_id,label_type,source_ref)
        where source_ref is not null
        do update set payload=excluded.payload,verified=true,confidence=1.0;
    end loop;
  end if;

  return jsonb_build_object(
    'ok',true,
    'actionId',a.id,
    'messageId',v_message_id,
    'offerId',v_offer_id,
    'offerAmount',v_offer_amount
  );
end;
$$;

revoke all on function public.ai_buyer_finalize_manual_reply(uuid,text) from public,anon,authenticated;
grant execute on function public.ai_buyer_finalize_manual_reply(uuid,text) to service_role;

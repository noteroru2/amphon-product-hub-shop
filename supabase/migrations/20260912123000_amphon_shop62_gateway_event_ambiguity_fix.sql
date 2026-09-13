-- SHOP-6.2 forward fix: make gateway event/refund functions explicit about
-- PL/pgSQL values versus table columns. Keep the public signatures unchanged.

create or replace function public.process_gateway_payment_event(
  provider_name text,
  provider_event_id text,
  normalized_event text,
  target_order_id uuid default null,
  provider_payment_id text default null,
  amount_minor bigint default null,
  currency_code text default null,
  event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_event_id uuid;
  o public.commerce_orders%rowtype;
  expected_minor bigint;
  v_provider_name text := upper(provider_name);
  v_provider_event_id text := provider_event_id;
  v_action text := upper(normalized_event);
  v_target_order_id uuid := target_order_id;
  v_provider_payment_id text := provider_payment_id;
  v_amount_minor bigint := amount_minor;
  v_currency_code text := upper(currency_code);
  v_event_payload jsonb := coalesce(event_payload,'{}'::jsonb);
  item record;
begin
  insert into public.commerce_payment_events(provider,provider_event_id,event_type,order_id,provider_payment_id,amount_minor,currency,payload)
  values(v_provider_name,v_provider_event_id,v_action,v_target_order_id,v_provider_payment_id,v_amount_minor,v_currency_code,v_event_payload)
  on conflict on constraint commerce_payment_events_provider_provider_event_id_key do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then return jsonb_build_object('duplicate',true,'providerEventId',v_provider_event_id); end if;

  if v_target_order_id is not null then select co.* into o from public.commerce_orders as co where co.id=v_target_order_id for update;
  elsif v_provider_payment_id is not null then select co.* into o from public.commerce_orders as co where co.provider_payment_intent_id=v_provider_payment_id for update;
  end if;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or v_provider_name<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;

  if v_provider_payment_id is not null and o.provider_payment_intent_id is null then
    update public.commerce_orders as co set provider_payment_intent_id=v_provider_payment_id where co.id=o.id returning co.* into o;
  end if;

  if v_action='PAYMENT_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is null or v_amount_minor<>expected_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    if coalesce(v_currency_code,'')<>upper(o.currency) then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
    perform private.mark_commerce_order_paid(o.id,null,'STRIPE',v_provider_payment_id);
    update public.commerce_orders as co set provider_payment_status='PAID',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt
       set provider_status='PAID',payment_intent_id=coalesce(v_provider_payment_id,cpt.payment_intent_id),paid_at=coalesce(cpt.paid_at,now()),updated_at=now()
     where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='PAYMENT_FAILED' then
    update public.commerce_orders as co set provider_payment_status='FAILED' where co.id=o.id and co.payment_status='UNPAID';
    update public.commerce_payment_transactions as cpt set provider_status='FAILED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='CHECKOUT_EXPIRED' then
    if o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'EXPIRED'); end if;
    update public.commerce_orders as co set provider_payment_status='EXPIRED',provider_checkout_url=null where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='EXPIRED',updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
  elsif v_action='REFUND_SUCCEEDED' then
    expected_minor := round(o.total*100)::bigint;
    if v_amount_minor is not null and v_amount_minor<>expected_minor then raise exception 'PARTIAL_REFUND_NOT_SUPPORTED'; end if;
    if o.payment_status not in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRED'; end if;
    for item in select pitem.product_id from public.commerce_order_items as pitem where pitem.order_id=o.id order by pitem.product_id loop
      perform 1 from public.products as p where p.id=item.product_id for update;
      update public.products as p set status='returned',updated_by=null where p.id=item.product_id and p.status='sold';
    end loop;
    update public.commerce_orders as co set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='SUCCEEDED',provider_payment_status='REFUNDED' where co.id=o.id;
    update public.commerce_payment_transactions as cpt set provider_status='REFUNDED',refunded_at=now(),updated_at=now() where cpt.order_id=o.id and cpt.provider='STRIPE';
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_CONFIRMED',jsonb_build_object('provider','STRIPE'));
  elsif v_action='REFUND_FAILED' then
    update public.commerce_orders as co set payment_status=case when co.payment_status='REFUND_PENDING' then 'PAID' else co.payment_status end,refund_status='FAILED' where co.id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_FAILED',jsonb_build_object('provider','STRIPE'));
  else
    raise exception 'UNSUPPORTED_GATEWAY_EVENT';
  end if;

  update public.commerce_payment_events as cpe set processed=true,processed_at=now(),order_id=o.id where cpe.id=inserted_event_id;
  select co.* into o from public.commerce_orders as co where co.id=o.id;
  return jsonb_build_object('duplicate',false,'orderId',o.id,'orderNumber',o.order_number,'paymentStatus',o.payment_status,'orderStatus',o.order_status,'fulfillmentStatus',o.fulfillment_status);
end;
$$;

revoke all on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) to service_role;

create or replace function public.mark_commerce_gateway_refund_pending(target_order_id uuid, provider_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_provider_refund_id text := provider_refund_id;
begin
  select co.* into o from public.commerce_orders as co where co.id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;

  if o.payment_status='REFUNDED' then
    update public.commerce_orders as co
       set provider_refund_id = coalesce(v_provider_refund_id, co.provider_refund_id),
           refund_status = coalesce(co.refund_status, 'SUCCEEDED')
     where co.id=o.id
     returning co.* into o;
    return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',true);
  end if;

  if o.payment_status<>'PAID' then raise exception 'GATEWAY_PAID_ORDER_REQUIRED'; end if;
  update public.commerce_orders as co
     set payment_status='REFUND_PENDING',provider_refund_id=v_provider_refund_id,refund_status='PENDING'
   where co.id=o.id returning co.* into o;
  insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
  values(o.id,'REFUND_REQUESTED',jsonb_build_object('provider','STRIPE','refundId',v_provider_refund_id));
  return jsonb_build_object('orderId',o.id,'paymentStatus',o.payment_status,'refundStatus',o.refund_status,'alreadyRefunded',false);
end;
$$;

revoke all on function public.mark_commerce_gateway_refund_pending(uuid,text) from public, anon, authenticated;
grant execute on function public.mark_commerce_gateway_refund_pending(uuid,text) to service_role;

-- Preserve the production release gate explicitly.
update public.commerce_store_settings set purchase_enabled=false where id=1;

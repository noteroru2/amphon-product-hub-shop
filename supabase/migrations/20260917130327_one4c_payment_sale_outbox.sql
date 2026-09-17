-- AMPHON ONE-4C — durable Shop payment/release commands to AMPHON System.
-- Fail-closed: ONE orders never mutate Hub physical product status on payment/release.

create table if not exists private.one4_shop_stock_command_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  action text not null check (action in ('CONFIRM_SOLD','RELEASE')),
  command_key text not null unique,
  checkout_idempotency_key uuid not null,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','RETRY','DELIVERED','DEAD')),
  payload jsonb not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  system_result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists one4_shop_stock_command_outbox_ready_idx
  on private.one4_shop_stock_command_outbox(status, next_attempt_at, created_at);
create index if not exists one4_shop_stock_command_outbox_order_idx
  on private.one4_shop_stock_command_outbox(order_id, created_at desc);

revoke all on table private.one4_shop_stock_command_outbox from public, anon, authenticated;

create or replace function private.one4_enqueue_shop_stock_command(
  target_order_id uuid,
  command_action text,
  provider_name text,
  provider_payment_id text,
  paid_at_value timestamptz,
  release_reason text,
  actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  v_action text := upper(btrim(command_action));
  v_skus text[];
  v_sale_items jsonb;
  v_command_key text;
  v_payload jsonb;
  v_id uuid;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.one_stock_authority is not true then raise exception 'ONE4_SYSTEM_AUTHORITY_ORDER_REQUIRED'; end if;
  if v_action not in ('CONFIRM_SOLD','RELEASE') then raise exception 'ONE4_COMMAND_ACTION_INVALID'; end if;

  select
    array_agg(upper(btrim(oi.sku)) order by upper(btrim(oi.sku))),
    jsonb_agg(jsonb_build_object('sku',upper(btrim(oi.sku)),'unitPrice',oi.unit_price) order by upper(btrim(oi.sku)))
  into v_skus, v_sale_items
  from public.commerce_order_items oi
  where oi.order_id=target.id;

  if coalesce(cardinality(v_skus),0) < 1 then raise exception 'ONE4_ORDER_ITEMS_REQUIRED'; end if;

  if v_action='CONFIRM_SOLD' then
    if paid_at_value is null then raise exception 'ONE4_PAID_AT_REQUIRED'; end if;
    if nullif(btrim(coalesce(provider_name,'')),'') is null then raise exception 'ONE4_PAYMENT_PROVIDER_REQUIRED'; end if;
    v_command_key := 'shop:' || target.idempotency_key::text || ':confirm-sold:v1';
    v_payload := jsonb_build_object(
      'action','CONFIRM_SOLD',
      'commandKey',v_command_key,
      'checkoutIdempotencyKey',target.idempotency_key::text,
      'orderId',target.id::text,
      'skus',to_jsonb(v_skus),
      'saleItems',coalesce(v_sale_items,'[]'::jsonb),
      'paymentProvider',upper(btrim(provider_name)),
      'paymentReference',nullif(btrim(coalesce(provider_payment_id,'')),''),
      'paidAt',paid_at_value,
      'actorId',actor_id
    );
  else
    v_command_key := 'shop:' || target.idempotency_key::text || ':release:v1';
    v_payload := jsonb_build_object(
      'action','RELEASE',
      'commandKey',v_command_key,
      'checkoutIdempotencyKey',target.idempotency_key::text,
      'orderId',target.id::text,
      'skus',to_jsonb(v_skus),
      'reason',coalesce(nullif(btrim(release_reason),''),'SHOP_RELEASE_REQUESTED'),
      'actorId',actor_id
    );
  end if;

  insert into private.one4_shop_stock_command_outbox(
    order_id,action,command_key,checkout_idempotency_key,payload
  ) values (
    target.id,v_action,v_command_key,target.idempotency_key,v_payload
  )
  on conflict (command_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from private.one4_shop_stock_command_outbox
     where command_key=v_command_key;
  end if;
  return v_id;
end;
$$;

revoke all on function private.one4_enqueue_shop_stock_command(uuid,text,text,text,timestamptz,text,uuid) from public, anon, authenticated;

create or replace function private.one4_finalize_commerce_order_paid(
  target_order_id uuid,
  provider_name text,
  provider_payment_id text,
  paid_at_value timestamptz,
  actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  v_provider text := upper(coalesce(nullif(btrim(provider_name),''),'MANUAL'));
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.one_stock_authority is not true then raise exception 'ONE4_SYSTEM_AUTHORITY_ORDER_REQUIRED'; end if;
  if target.payment_status='PAID' then
    return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'duplicate',true);
  end if;
  if target.payment_status not in ('UNPAID','REVIEW') or target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if v_provider not in ('STRIPE','MANUAL') then raise exception 'ONE4_PAYMENT_PROVIDER_INVALID'; end if;
  if paid_at_value is null then raise exception 'ONE4_PAID_AT_REQUIRED'; end if;

  delete from public.commerce_reservations where order_id=target.id;

  update public.commerce_orders
     set payment_status='PAID',
         order_status='PROCESSING',
         fulfillment_status='PACKING',
         paid_at=coalesce(paid_at,paid_at_value),
         payment_provider=v_provider,
         provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),
         provider_payment_status='PAID',
         provider_checkout_url=null
   where id=target.id
   returning * into target;

  insert into public.commerce_payment_transactions(order_id,provider,payment_intent_id,provider_status,amount,currency,paid_at)
  values(target.id,v_provider,provider_payment_id,'PAID',target.total,target.currency,target.paid_at)
  on conflict(order_id,provider) do update
    set payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),
        provider_status='PAID',
        paid_at=coalesce(public.commerce_payment_transactions.paid_at,excluded.paid_at),
        updated_at=now();

  perform private.issue_commerce_document(target.id);
  insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
  values(target.id,'PAYMENT_CONFIRMED',actor_id,jsonb_build_object('provider',v_provider,'stockAuthority','amphon-system'));

  return jsonb_build_object(
    'orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,
    'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status,'duplicate',false
  );
end;
$$;

revoke all on function private.one4_finalize_commerce_order_paid(uuid,text,text,timestamptz,uuid) from public, anon, authenticated;

create or replace function private.mark_commerce_order_paid(
  target_order_id uuid,
  actor_id uuid default null,
  provider_name text default 'MANUAL',
  provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.commerce_orders%rowtype;
  item record;
  v_command_id uuid;
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.payment_status = 'PAID' then
    return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status);
  end if;
  if target.payment_status not in ('UNPAID','REVIEW') or target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if target.reservation_expires_at <= now() then raise exception 'RESERVATION_EXPIRED'; end if;

  if target.one_stock_authority is true then
    v_command_id := private.one4_enqueue_shop_stock_command(
      target.id,'CONFIRM_SOLD',upper(coalesce(provider_name,'MANUAL')),provider_payment_id,now(),null,actor_id
    );
    update public.commerce_orders
       set provider_payment_status=case
         when upper(coalesce(provider_name,'MANUAL'))='MANUAL' then 'SYSTEM_SALE_PENDING'
         else provider_payment_status
       end
     where id=target.id
     returning * into target;
    return jsonb_build_object(
      'orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,
      'orderStatus',target.order_status,'systemSalePending',true,'systemCommandId',v_command_id
    );
  end if;

  for item in select product_id from public.commerce_order_items where order_id=target.id order by product_id loop
    perform 1 from public.products where id=item.product_id for update;
    update public.products set status='sold', updated_by=actor_id
     where id=item.product_id and status='reserved'
       and exists(select 1 from public.commerce_reservations r where r.product_id=item.product_id and r.order_id=target.id);
    if not found then raise exception 'RESERVED_PRODUCT_STATE_MISMATCH'; end if;
  end loop;

  delete from public.commerce_reservations where order_id=target.id;
  update public.commerce_orders
     set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=coalesce(paid_at,now()),
         payment_provider=upper(coalesce(provider_name,'MANUAL')),
         provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),
         provider_payment_status='PAID'
   where id=target.id
   returning * into target;

  insert into public.commerce_payment_transactions(order_id,provider,payment_intent_id,provider_status,amount,currency,paid_at)
  values (target.id,upper(coalesce(provider_name,'MANUAL')),provider_payment_id,'PAID',target.total,target.currency,target.paid_at)
  on conflict (order_id,provider) do update
    set payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),
        provider_status='PAID',paid_at=coalesce(public.commerce_payment_transactions.paid_at,excluded.paid_at),updated_at=now();

  perform private.issue_commerce_document(target.id);
  insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
  values(target.id,'PAYMENT_CONFIRMED',actor_id,jsonb_build_object('provider',upper(coalesce(provider_name,'MANUAL'))));

  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status);
end;
$$;

revoke all on function private.mark_commerce_order_paid(uuid,uuid,text,text) from public, anon, authenticated;

create or replace function private.release_commerce_order_inventory(target_order_id uuid, terminal_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  released integer := 0;
  target public.commerce_orders%rowtype;
  v_terminal text := upper(btrim(terminal_status));
begin
  select * into target
    from public.commerce_orders o
   where o.id=target_order_id
     and o.payment_status in ('UNPAID','REVIEW')
     and o.order_status not in ('CANCELLED','EXPIRED','COMPLETED','REFUNDED')
   for update;
  if target.id is null then return 0; end if;

  if target.one_stock_authority is true then
    if v_terminal not in ('CANCELLED','EXPIRED') then raise exception 'ONE4_RELEASE_TERMINAL_STATUS_INVALID'; end if;
    perform private.one4_enqueue_shop_stock_command(
      target.id,'RELEASE',null,null,null,
      case when v_terminal='EXPIRED' then 'SHOP_RESERVATION_EXPIRED' else 'SHOP_ORDER_CANCELLED' end,
      null
    );
    update public.commerce_orders o
       set order_status=v_terminal,
           fulfillment_status='CANCELLED',
           cancelled_at=case when v_terminal='CANCELLED' then now() else o.cancelled_at end,
           expired_at=case when v_terminal='EXPIRED' then now() else o.expired_at end
     where o.id=target.id and o.payment_status in ('UNPAID','REVIEW');
    return 0;
  end if;

  for item in
    select oi.product_id
      from public.commerce_order_items oi
     where oi.order_id = target_order_id
     order by oi.product_id
     for update
  loop
    perform 1 from public.products p where p.id = item.product_id for update;
    update public.products p
       set status = 'published', updated_by = null
     where p.id = item.product_id
       and p.status = 'reserved'
       and exists (
         select 1 from public.commerce_reservations r
          where r.product_id = p.id and r.order_id = target_order_id
       );
    if found then released := released + 1; end if;
  end loop;

  delete from public.commerce_reservations r where r.order_id = target_order_id;

  update public.commerce_orders o
     set order_status = terminal_status,
         fulfillment_status = 'CANCELLED',
         cancelled_at = case when terminal_status = 'CANCELLED' then now() else o.cancelled_at end,
         expired_at = case when terminal_status = 'EXPIRED' then now() else o.expired_at end
   where o.id = target_order_id
     and o.payment_status in ('UNPAID','REVIEW');

  return released;
end;
$$;

revoke all on function private.release_commerce_order_inventory(uuid,text) from public, anon, authenticated;

create or replace function public.one4_claim_shop_stock_commands(max_commands integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(25,greatest(1,coalesce(max_commands,10)));
  result jsonb;
begin
  with picked as (
    select o.id
      from private.one4_shop_stock_command_outbox o
     where (
       (o.status in ('PENDING','RETRY') and o.next_attempt_at <= now())
       or (o.status='PROCESSING' and o.locked_at < now() - interval '10 minutes')
     )
     order by o.created_at,o.id
     for update skip locked
     limit v_limit
  ), claimed as (
    update private.one4_shop_stock_command_outbox o
       set status='PROCESSING',attempts=o.attempts+1,locked_at=now(),updated_at=now()
      from picked p
     where o.id=p.id
     returning o.id,o.order_id,o.action,o.command_key,o.payload,o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'orderId',c.order_id,'action',c.action,'commandKey',c.command_key,
    'payload',c.payload,'attempts',c.attempts
  ) order by c.id),'[]'::jsonb)
  into result
  from claimed c;
  return result;
end;
$$;

revoke all on function public.one4_claim_shop_stock_commands(integer) from public, anon, authenticated;
grant execute on function public.one4_claim_shop_stock_commands(integer) to service_role;

create or replace function public.one4_complete_shop_stock_command(p_command_id uuid, p_system_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmd private.one4_shop_stock_command_outbox%rowtype;
  outcome text;
  finalized jsonb;
begin
  select * into cmd from private.one4_shop_stock_command_outbox where id=p_command_id for update;
  if cmd.id is null then raise exception 'ONE4_COMMAND_NOT_FOUND'; end if;
  if cmd.status='DELIVERED' then
    return jsonb_build_object('id',cmd.id,'status',cmd.status,'duplicate',true);
  end if;
  if cmd.status<>'PROCESSING' then raise exception 'ONE4_COMMAND_NOT_PROCESSING'; end if;
  if coalesce((p_system_result->>'ok')::boolean,false) is not true then raise exception 'ONE4_SYSTEM_RESULT_NOT_OK'; end if;
  outcome := upper(coalesce(p_system_result->>'outcome',''));

  if cmd.action='CONFIRM_SOLD' then
    if outcome<>'SOLD' then raise exception 'ONE4_SYSTEM_SALE_NOT_CONFIRMED'; end if;
    finalized := private.one4_finalize_commerce_order_paid(
      cmd.order_id,
      coalesce(cmd.payload->>'paymentProvider','MANUAL'),
      cmd.payload->>'paymentReference',
      (cmd.payload->>'paidAt')::timestamptz,
      null
    );
  elsif cmd.action='RELEASE' then
    if outcome<>'RELEASED' then raise exception 'ONE4_SYSTEM_RELEASE_NOT_CONFIRMED'; end if;
    delete from public.commerce_reservations where order_id=cmd.order_id;
    finalized := jsonb_build_object('orderId',cmd.order_id,'released',true);
  else
    raise exception 'ONE4_COMMAND_ACTION_INVALID';
  end if;

  update private.one4_shop_stock_command_outbox
     set status='DELIVERED',delivered_at=now(),system_result=p_system_result,last_error=null,locked_at=null,updated_at=now()
   where id=cmd.id;

  return jsonb_build_object('id',cmd.id,'status','DELIVERED','action',cmd.action,'finalized',finalized);
end;
$$;

revoke all on function public.one4_complete_shop_stock_command(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.one4_complete_shop_stock_command(uuid,jsonb) to service_role;

create or replace function public.one4_fail_shop_stock_command(p_command_id uuid, p_error text, p_retryable boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmd private.one4_shop_stock_command_outbox%rowtype;
  v_dead boolean;
  v_status text;
begin
  select * into cmd from private.one4_shop_stock_command_outbox where id=p_command_id for update;
  if cmd.id is null then raise exception 'ONE4_COMMAND_NOT_FOUND'; end if;
  if cmd.status='DELIVERED' then return jsonb_build_object('id',cmd.id,'status',cmd.status,'duplicate',true); end if;
  v_dead := (coalesce(p_retryable,true) is not true) or cmd.attempts >= 8;
  v_status := case when v_dead then 'DEAD' else 'RETRY' end;

  update private.one4_shop_stock_command_outbox
     set status=v_status,
         last_error=left(coalesce(p_error,'ONE4_SYSTEM_COMMAND_FAILED'),1000),
         next_attempt_at=case when v_dead then next_attempt_at else now()+interval '30 seconds' end,
         locked_at=null,
         updated_at=now()
   where id=cmd.id;

  if v_dead then
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
    values(cmd.order_id,'SYSTEM_STOCK_COMMAND_FAILED',jsonb_build_object('commandId',cmd.id,'action',cmd.action,'error',left(coalesce(p_error,''),500)));
  end if;

  return jsonb_build_object('id',cmd.id,'status',v_status,'attempts',cmd.attempts,'retryable',not v_dead);
end;
$$;

revoke all on function public.one4_fail_shop_stock_command(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.one4_fail_shop_stock_command(uuid,text,boolean) to service_role;

comment on table private.one4_shop_stock_command_outbox is
  'ONE-4C durable Shop-to-System stock command queue. System remains canonical sale/reservation authority.';

-- Production checkout remains locked until ONE-4D acceptance.
update public.commerce_store_settings set purchase_enabled=false where id=1;

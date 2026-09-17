-- AMPHON ONE-4C — durable Shop payment/release coordination with System stock authority.
-- Additive/fail-closed. This migration does NOT enable purchase_enabled or Worker/System flags.

alter table public.commerce_orders
  add column if not exists one_stock_state text not null default 'NONE',
  add column if not exists one_stock_last_error text,
  add column if not exists one_stock_updated_at timestamptz,
  add column if not exists one_system_sale_confirmed_at timestamptz,
  add column if not exists one_system_released_at timestamptz;

alter table public.commerce_orders drop constraint if exists commerce_orders_one_stock_state_check;
alter table public.commerce_orders add constraint commerce_orders_one_stock_state_check
  check (one_stock_state in ('NONE','RESERVED','SALE_CONFIRM_PENDING','SOLD','RELEASE_PENDING','RELEASED','CONFLICT'));

update public.commerce_orders
set one_stock_state='RESERVED', one_stock_updated_at=coalesce(one_stock_updated_at,now())
where one_stock_authority is true and one_stock_state='NONE';

create table if not exists public.commerce_one_stock_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  action text not null check (action in ('CONFIRM_SOLD','RELEASE')),
  task_key text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','RETRY','SUCCEEDED','CONFLICT')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(order_id,action)
);

create index if not exists commerce_one_stock_tasks_pending_idx
  on public.commerce_one_stock_tasks(status,next_attempt_at,created_at);

alter table public.commerce_one_stock_tasks enable row level security;
revoke all on public.commerce_one_stock_tasks from public, anon, authenticated;
grant select,insert,update,delete on public.commerce_one_stock_tasks to service_role;

create or replace function private.enqueue_one4_stock_task(target_order_id uuid, action_name text, reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_action text := upper(coalesce(action_name,''));
  v_task_key text;
  v_payload jsonb;
  v_skus jsonb;
  v_sale_items jsonb;
  v_task_id uuid;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.one_stock_authority is not true then raise exception 'ONE4_ORDER_REQUIRED'; end if;
  if v_action not in ('CONFIRM_SOLD','RELEASE') then raise exception 'ONE4_TASK_ACTION_INVALID'; end if;

  select coalesce(jsonb_agg(to_jsonb(i.sku) order by i.sku),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('sku',i.sku,'unitPrice',i.unit_price) order by i.sku),'[]'::jsonb)
    into v_skus,v_sale_items
    from public.commerce_order_items i where i.order_id=o.id;
  if jsonb_array_length(v_skus)<1 then raise exception 'ONE4_ORDER_ITEMS_MISSING'; end if;

  if v_action='CONFIRM_SOLD' then
    if o.payment_status<>'PAID' or o.paid_at is null then raise exception 'ONE4_PAID_ORDER_REQUIRED'; end if;
    v_task_key := 'shop:'||o.idempotency_key::text||':confirm-sold:v1';
    v_payload := jsonb_build_object(
      'checkoutIdempotencyKey',o.idempotency_key::text,
      'orderId',o.id::text,
      'skus',v_skus,
      'saleItems',v_sale_items,
      'paymentProvider',upper(coalesce(o.payment_provider,'MANUAL')),
      'paymentReference',o.provider_payment_intent_id,
      'paidAt',o.paid_at
    );
  else
    if o.payment_status in ('PAID','REFUND_PENDING','REFUNDED') then raise exception 'ONE4_PAID_ORDER_RELEASE_BLOCKED'; end if;
    v_task_key := 'shop:'||o.idempotency_key::text||':release:v1';
    v_payload := jsonb_build_object(
      'checkoutIdempotencyKey',o.idempotency_key::text,
      'orderId',o.id::text,
      'skus',v_skus,
      'reason',left(coalesce(nullif(reason,''),'SHOP_ORDER_RELEASE'),120)
    );
  end if;

  insert into public.commerce_one_stock_tasks(order_id,action,task_key,status,payload,next_attempt_at)
  values(o.id,v_action,v_task_key,'PENDING',v_payload,now())
  on conflict (order_id,action) do update
    set payload=case when public.commerce_one_stock_tasks.status in ('PENDING','RETRY') then excluded.payload else public.commerce_one_stock_tasks.payload end,
        next_attempt_at=case when public.commerce_one_stock_tasks.status in ('PENDING','RETRY') then least(public.commerce_one_stock_tasks.next_attempt_at,now()) else public.commerce_one_stock_tasks.next_attempt_at end,
        updated_at=now()
  returning id into v_task_id;

  update public.commerce_orders
     set one_stock_state=case when v_action='CONFIRM_SOLD' then 'SALE_CONFIRM_PENDING' else 'RELEASE_PENDING' end,
         one_stock_last_error=null,
         one_stock_updated_at=now()
   where id=o.id and one_stock_state not in ('SOLD','RELEASED');
  return v_task_id;
end;
$$;

-- Preserve the pre-ONE-4 commerce implementation exactly for non-ONE orders.
alter function private.mark_commerce_order_paid(uuid,uuid,text,text)
  rename to mark_commerce_order_paid_pre_one4c;

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
begin
  select * into target from public.commerce_orders where id=target_order_id for update;
  if target.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if target.one_stock_authority is not true then
    return private.mark_commerce_order_paid_pre_one4c(target_order_id,actor_id,provider_name,provider_payment_id);
  end if;
  if target.payment_status='PAID' then
    perform private.enqueue_one4_stock_task(target.id,'CONFIRM_SOLD','PAYMENT_ALREADY_ACCEPTED');
    return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status,'oneStockState','SALE_CONFIRM_PENDING');
  end if;
  if target.payment_status not in ('UNPAID','REVIEW') or target.order_status not in ('AWAITING_PAYMENT','PAYMENT_REVIEW') then raise exception 'ORDER_NOT_PAYABLE'; end if;
  if target.reservation_expires_at <= now() then raise exception 'RESERVATION_EXPIRED'; end if;

  update public.commerce_orders
     set payment_status='PAID', order_status='PROCESSING', fulfillment_status='PACKING', paid_at=coalesce(paid_at,now()),
         payment_provider=upper(coalesce(provider_name,'MANUAL')),
         provider_payment_intent_id=coalesce(provider_payment_id,provider_payment_intent_id),
         provider_payment_status='PAID'
   where id=target.id returning * into target;

  insert into public.commerce_payment_transactions(order_id,provider,payment_intent_id,provider_status,amount,currency,paid_at)
  values(target.id,upper(coalesce(provider_name,'MANUAL')),provider_payment_id,'PAID',target.total,target.currency,target.paid_at)
  on conflict(order_id,provider) do update
    set payment_intent_id=coalesce(excluded.payment_intent_id,public.commerce_payment_transactions.payment_intent_id),
        provider_status='PAID',paid_at=coalesce(public.commerce_payment_transactions.paid_at,excluded.paid_at),updated_at=now();

  perform private.issue_commerce_document(target.id);
  insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
  values(target.id,'PAYMENT_CONFIRMED',actor_id,jsonb_build_object('provider',upper(coalesce(provider_name,'MANUAL'))));
  perform private.enqueue_one4_stock_task(target.id,'CONFIRM_SOLD','PAYMENT_CONFIRMED');
  return jsonb_build_object('orderId',target.id,'orderNumber',target.order_number,'paymentStatus',target.payment_status,'orderStatus',target.order_status,'fulfillmentStatus',target.fulfillment_status,'oneStockState','SALE_CONFIRM_PENDING');
end;
$$;

alter function private.release_commerce_order_inventory(uuid,text)
  rename to release_commerce_order_inventory_pre_one4c;

create or replace function private.release_commerce_order_inventory(target_order_id uuid, terminal_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_count integer := 0;
begin
  select * into o from public.commerce_orders where id=target_order_id for update;
  if o.id is null then return 0; end if;
  if o.one_stock_authority is not true then
    return private.release_commerce_order_inventory_pre_one4c(target_order_id,terminal_status);
  end if;
  if o.payment_status not in ('UNPAID','REVIEW') then return 0; end if;
  select count(*)::integer into v_count from public.commerce_reservations where order_id=o.id;
  perform private.enqueue_one4_stock_task(o.id,'RELEASE',terminal_status);
  update public.commerce_orders
     set order_status=terminal_status,
         fulfillment_status='CANCELLED',
         cancelled_at=case when terminal_status='CANCELLED' then now() else cancelled_at end,
         expired_at=case when terminal_status='EXPIRED' then now() else expired_at end
   where id=o.id;
  return v_count;
end;
$$;

create or replace function public.one4_claim_stock_tasks(max_tasks integer default 25, target_order_id uuid default null)
returns table(id uuid,order_id uuid,action text,task_key text,payload jsonb,attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select t.id from public.commerce_one_stock_tasks t
     where (target_order_id is null or t.order_id=target_order_id)
       and ((t.status in ('PENDING','RETRY') and t.next_attempt_at<=now()) or (t.status='PROCESSING' and t.locked_at<now()-interval '5 minutes'))
     order by t.created_at
     for update skip locked
     limit greatest(1,least(coalesce(max_tasks,25),100))
  ), claimed as (
    update public.commerce_one_stock_tasks t
       set status='PROCESSING',attempts=t.attempts+1,locked_at=now(),updated_at=now()
     where t.id in (select picked.id from picked)
     returning t.id,t.order_id,t.action,t.task_key,t.payload,t.attempts
  )
  select c.id,c.order_id,c.action,c.task_key,c.payload,c.attempts from claimed c order by c.id;
end;
$$;

revoke all on function public.one4_claim_stock_tasks(integer,uuid) from public,anon,authenticated;
grant execute on function public.one4_claim_stock_tasks(integer,uuid) to service_role;

create or replace function public.one4_complete_stock_task(
  task_id uuid,
  succeeded boolean,
  task_result jsonb default '{}'::jsonb,
  error_code text default null,
  retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.commerce_one_stock_tasks%rowtype;
  next_delay interval;
begin
  select * into t from public.commerce_one_stock_tasks where id=task_id for update;
  if t.id is null then raise exception 'ONE4_TASK_NOT_FOUND'; end if;
  if t.status='SUCCEEDED' then return jsonb_build_object('taskId',t.id,'status',t.status,'duplicate',true); end if;

  if succeeded then
    update public.commerce_one_stock_tasks
       set status='SUCCEEDED',result=coalesce(task_result,'{}'::jsonb),last_error=null,locked_at=null,completed_at=now(),updated_at=now()
     where id=t.id;
    delete from public.commerce_reservations where order_id=t.order_id;
    update public.commerce_orders
       set one_stock_state=case when t.action='CONFIRM_SOLD' then 'SOLD' else 'RELEASED' end,
           one_stock_last_error=null,one_stock_updated_at=now(),
           one_system_sale_confirmed_at=case when t.action='CONFIRM_SOLD' then coalesce(one_system_sale_confirmed_at,now()) else one_system_sale_confirmed_at end,
           one_system_released_at=case when t.action='RELEASE' then coalesce(one_system_released_at,now()) else one_system_released_at end
     where id=t.order_id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
    values(t.order_id,case when t.action='CONFIRM_SOLD' then 'ONE_SYSTEM_SOLD' else 'ONE_SYSTEM_RELEASED' end,jsonb_build_object('taskId',t.id,'attempts',t.attempts));
    return jsonb_build_object('taskId',t.id,'status','SUCCEEDED','action',t.action,'orderId',t.order_id);
  end if;

  if retryable then
    next_delay := make_interval(secs => least(1800, greatest(30, 30 * (2 ^ least(t.attempts,6))::integer)));
    update public.commerce_one_stock_tasks
       set status='RETRY',last_error=left(coalesce(error_code,'ONE4_SYSTEM_UNKNOWN'),280),locked_at=null,next_attempt_at=now()+next_delay,updated_at=now()
     where id=t.id;
  else
    update public.commerce_one_stock_tasks
       set status='CONFLICT',last_error=left(coalesce(error_code,'ONE4_SYSTEM_CONFLICT'),280),locked_at=null,updated_at=now()
     where id=t.id;
    update public.commerce_orders
       set one_stock_state='CONFLICT',one_stock_last_error=left(coalesce(error_code,'ONE4_SYSTEM_CONFLICT'),280),one_stock_updated_at=now()
     where id=t.order_id;
  end if;
  return jsonb_build_object('taskId',t.id,'status',case when retryable then 'RETRY' else 'CONFLICT' end,'action',t.action,'orderId',t.order_id);
end;
$$;

revoke all on function public.one4_complete_stock_task(uuid,boolean,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.one4_complete_stock_task(uuid,boolean,jsonb,text,boolean) to service_role;

-- Manual admin actions keep the legacy state machine, except physical refund reversal is forbidden for ONE-managed stock.
alter function public.admin_commerce_order_action(uuid,text,uuid,jsonb)
  rename to admin_commerce_order_action_pre_one4c;

create or replace function public.admin_commerce_order_action(target_order_id uuid,action_name text,actor_id uuid,action_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.commerce_orders%rowtype;
  v_action text := upper(coalesce(action_name,''));
begin
  select * into o from public.commerce_orders where id=target_order_id;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.one_stock_authority is not true then
    return public.admin_commerce_order_action_pre_one4c(target_order_id,action_name,actor_id,action_data);
  end if;
  if v_action='REFUND' then
    if o.payment_provider='STRIPE' or o.payment_method='STRIPE' then raise exception 'GATEWAY_REFUND_REQUIRED'; end if;
    if o.payment_status<>'PAID' then raise exception 'PAID_ORDER_REQUIRED'; end if;
    update public.commerce_orders set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='MANUAL_CONFIRMED' where id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,actor_id,metadata)
    values(o.id,'REFUND_CONFIRMED',actor_id,jsonb_build_object('provider','MANUAL','physicalStockUnchanged',true));
    return jsonb_build_object('orderId',o.id,'paymentStatus','REFUNDED','orderStatus','REFUNDED','physicalStockUnchanged',true);
  end if;
  return public.admin_commerce_order_action_pre_one4c(target_order_id,action_name,actor_id,action_data);
end;
$$;

revoke all on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.admin_commerce_order_action(uuid,text,uuid,jsonb) to service_role;

-- Override gateway event handling only where ONE stock semantics differ. Legacy orders preserve prior behavior.
create or replace function public.process_gateway_payment_event(
  provider_name text,provider_event_id text,normalized_event text,target_order_id uuid default null,
  provider_payment_id text default null,amount_minor bigint default null,currency_code text default null,event_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_event_id uuid; o public.commerce_orders%rowtype; expected_minor bigint;
  v_provider_name text:=upper(provider_name); v_provider_event_id text:=provider_event_id; v_action text:=upper(normalized_event);
  v_target_order_id uuid:=target_order_id; v_provider_payment_id text:=provider_payment_id; v_amount_minor bigint:=amount_minor;
  v_currency_code text:=upper(currency_code); v_event_payload jsonb:=coalesce(event_payload,'{}'::jsonb); item record;
begin
  insert into public.commerce_payment_events(provider,provider_event_id,event_type,order_id,provider_payment_id,amount_minor,currency,payload)
  values(v_provider_name,v_provider_event_id,v_action,v_target_order_id,v_provider_payment_id,v_amount_minor,v_currency_code,v_event_payload)
  on conflict on constraint commerce_payment_events_provider_provider_event_id_key do nothing returning id into inserted_event_id;
  if inserted_event_id is null then return jsonb_build_object('duplicate',true,'providerEventId',v_provider_event_id); end if;

  if v_target_order_id is not null then select * into o from public.commerce_orders where id=v_target_order_id for update;
  elsif v_provider_payment_id is not null then select * into o from public.commerce_orders where provider_payment_intent_id=v_provider_payment_id for update; end if;
  if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.payment_provider<>'STRIPE' or v_provider_name<>'STRIPE' then raise exception 'GATEWAY_ORDER_REQUIRED'; end if;
  if v_provider_payment_id is not null and o.provider_payment_intent_id is null then
    update public.commerce_orders set provider_payment_intent_id=v_provider_payment_id where id=o.id returning * into o;
  end if;

  if v_action='PAYMENT_SUCCEEDED' then
    expected_minor:=round(o.total*100)::bigint;
    if v_amount_minor is null or v_amount_minor<>expected_minor then raise exception 'PAYMENT_AMOUNT_MISMATCH'; end if;
    if coalesce(v_currency_code,'')<>upper(o.currency) then raise exception 'PAYMENT_CURRENCY_MISMATCH'; end if;
    perform private.mark_commerce_order_paid(o.id,null,'STRIPE',v_provider_payment_id);
    update public.commerce_orders set provider_payment_status='PAID',provider_checkout_url=null where id=o.id;
    update public.commerce_payment_transactions set provider_status='PAID',payment_intent_id=coalesce(v_provider_payment_id,payment_intent_id),paid_at=coalesce(paid_at,now()),updated_at=now() where order_id=o.id and provider='STRIPE';
  elsif v_action in ('PAYMENT_FAILED','PAYMENT_FAILED_TERMINAL') then
    update public.commerce_orders set provider_payment_status='FAILED' where id=o.id and payment_status='UNPAID';
    update public.commerce_payment_transactions set provider_status='FAILED',updated_at=now() where order_id=o.id and provider='STRIPE';
    if v_action='PAYMENT_FAILED_TERMINAL' and o.one_stock_authority is true and o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'CANCELLED'); end if;
  elsif v_action='CHECKOUT_EXPIRED' then
    if o.payment_status in ('UNPAID','REVIEW') then perform private.release_commerce_order_inventory(o.id,'EXPIRED'); end if;
    update public.commerce_orders set provider_payment_status='EXPIRED',provider_checkout_url=null where id=o.id;
    update public.commerce_payment_transactions set provider_status='EXPIRED',updated_at=now() where order_id=o.id and provider='STRIPE';
  elsif v_action='REFUND_SUCCEEDED' then
    expected_minor:=round(o.total*100)::bigint;
    if v_amount_minor is not null and v_amount_minor<>expected_minor then raise exception 'PARTIAL_REFUND_NOT_SUPPORTED'; end if;
    if o.payment_status not in ('PAID','REFUND_PENDING') then raise exception 'PAID_ORDER_REQUIRED'; end if;
    if o.one_stock_authority is not true then
      for item in select product_id from public.commerce_order_items where order_id=o.id order by product_id loop
        perform 1 from public.products where id=item.product_id for update;
        update public.products set status='returned',updated_by=null where id=item.product_id and status='sold';
      end loop;
    end if;
    update public.commerce_orders set payment_status='REFUNDED',order_status='REFUNDED',fulfillment_status='CANCELLED',refunded_at=now(),refund_status='SUCCEEDED',provider_payment_status='REFUNDED' where id=o.id;
    update public.commerce_payment_transactions set provider_status='REFUNDED',refunded_at=now(),updated_at=now() where order_id=o.id and provider='STRIPE';
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata)
    values(o.id,'REFUND_CONFIRMED',jsonb_build_object('provider','STRIPE','physicalStockUnchanged',o.one_stock_authority is true));
  elsif v_action='REFUND_FAILED' then
    update public.commerce_orders set payment_status=case when payment_status='REFUND_PENDING' then 'PAID' else payment_status end,refund_status='FAILED' where id=o.id;
    insert into public.commerce_fulfillment_events(order_id,event_type,metadata) values(o.id,'REFUND_FAILED',jsonb_build_object('provider','STRIPE'));
  else raise exception 'UNSUPPORTED_GATEWAY_EVENT'; end if;

  update public.commerce_payment_events set processed=true,processed_at=now(),order_id=o.id where id=inserted_event_id;
  select * into o from public.commerce_orders where id=o.id;
  return jsonb_build_object('duplicate',false,'orderId',o.id,'orderNumber',o.order_number,'paymentStatus',o.payment_status,'orderStatus',o.order_status,'fulfillmentStatus',o.fulfillment_status,'oneStockAuthority',o.one_stock_authority,'oneStockState',o.one_stock_state);
end;
$$;

revoke all on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.process_gateway_payment_event(text,text,text,uuid,text,bigint,text,jsonb) to service_role;

-- Production remains closed through source development.
update public.commerce_store_settings set purchase_enabled=false where id=1;

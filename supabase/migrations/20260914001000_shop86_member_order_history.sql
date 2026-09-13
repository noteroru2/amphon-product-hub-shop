-- AMPHON SHOP — SHOP-8.6 My Orders / Member Order History
-- Read-only member-facing order history. No direct customer table access is granted.

create or replace function public.get_my_orders(
  page_limit integer default 20,
  page_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  safe_limit integer := least(greatest(coalesce(page_limit, 20), 1), 50);
  safe_offset integer := greatest(coalesce(page_offset, 0), 0);
  total_count integer := 0;
  rows_json jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
      from public.commerce_customer_profiles cp
     where cp.auth_user_id = actor_id
       and cp.status = 'ACTIVE'
  ) then
    raise exception 'CUSTOMER_PROFILE_NOT_FOUND';
  end if;

  select count(*)::integer
    into total_count
    from public.commerce_orders o
   where o.auth_user_id = actor_id;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
    into rows_json
    from (
      select
        o.created_at,
        jsonb_strip_nulls(jsonb_build_object(
          'orderId', o.id,
          'orderNumber', o.order_number,
          'orderStatus', o.order_status,
          'paymentStatus', o.payment_status,
          'fulfillmentStatus', o.fulfillment_status,
          'paymentMethod', o.payment_method,
          'paymentProvider', o.payment_provider,
          'deliveryMethod', o.delivery_method,
          'currency', o.currency,
          'subtotal', o.subtotal,
          'shippingAmount', o.shipping_amount,
          'total', o.total,
          'reservationExpiresAt', o.reservation_expires_at,
          'paidAt', o.paid_at,
          'shippedAt', o.shipped_at,
          'completedAt', o.completed_at,
          'trackingCarrier', o.tracking_carrier,
          'trackingNumber', o.tracking_number,
          'itemCount', (select count(*) from public.commerce_order_items oi where oi.order_id = o.id),
          'itemTitles', coalesce((
            select jsonb_agg(x.title order by x.created_at)
              from (
                select oi.title, oi.created_at
                  from public.commerce_order_items oi
                 where oi.order_id = o.id
                 order by oi.created_at
                 limit 3
              ) x
          ), '[]'::jsonb),
          'hasDocument', exists (
            select 1 from public.commerce_documents d
             where d.order_id = o.id and d.voided_at is null
          ),
          'warrantyCount', (select count(*) from public.commerce_warranties w where w.order_id = o.id),
          'createdAt', o.created_at,
          'updatedAt', o.updated_at
        )) as row_data
      from public.commerce_orders o
      where o.auth_user_id = actor_id
      order by o.created_at desc
      limit safe_limit offset safe_offset
    ) q;

  return jsonb_build_object(
    'orders', rows_json,
    'pagination', jsonb_build_object(
      'total', total_count,
      'limit', safe_limit,
      'offset', safe_offset,
      'hasMore', safe_offset + jsonb_array_length(rows_json) < total_count
    )
  );
end;
$$;

revoke all on function public.get_my_orders(integer, integer) from public, anon;
grant execute on function public.get_my_orders(integer, integer) to authenticated;
grant execute on function public.get_my_orders(integer, integer) to service_role;

comment on function public.get_my_orders(integer, integer) is
'SHOP-8.6: returns read-only order-history summaries owned by auth.uid().';

create or replace function public.get_my_order_detail(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_order public.commerce_orders%rowtype;
  items_json jsonb := '[]'::jsonb;
  shipment_json jsonb := null;
  document_json jsonb := null;
  warranties_json jsonb := '[]'::jsonb;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into target_order
    from public.commerce_orders o
   where o.id = target_order_id
     and o.auth_user_id = actor_id
   limit 1;

  if target_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'sku', oi.sku,
    'title', oi.title,
    'unitPrice', oi.unit_price,
    'quantity', oi.quantity,
    'condition', oi.merchant_item_condition,
    'warrantyDays', oi.warranty_days,
    'warrantyTerms', oi.warranty_terms
  )) order by oi.created_at), '[]'::jsonb)
    into items_json
    from public.commerce_order_items oi
   where oi.order_id = target_order.id;

  select jsonb_strip_nulls(jsonb_build_object(
    'carrier', s.carrier,
    'trackingNumber', s.tracking_number,
    'trackingUrl', s.tracking_url,
    'status', s.status,
    'shippedAt', s.shipped_at,
    'deliveredAt', s.delivered_at
  ))
    into shipment_json
    from public.commerce_shipments s
   where s.order_id = target_order.id
   limit 1;

  select jsonb_strip_nulls(jsonb_build_object(
    'publicToken', d.public_token,
    'number', d.document_number,
    'type', d.document_type,
    'issuedAt', d.issued_at
  ))
    into document_json
    from public.commerce_documents d
   where d.order_id = target_order.id
     and d.voided_at is null
   order by d.issued_at desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'publicToken', w.public_token,
    'certificateNumber', w.certificate_number,
    'sku', w.sku,
    'title', w.title,
    'warrantyDays', w.warranty_days,
    'terms', w.terms,
    'status', w.status,
    'startsAt', w.starts_at,
    'endsAt', w.ends_at
  )) order by w.created_at), '[]'::jsonb)
    into warranties_json
    from public.commerce_warranties w
   where w.order_id = target_order.id;

  return jsonb_strip_nulls(jsonb_build_object(
    'orderId', target_order.id,
    'publicToken', target_order.public_token,
    'orderNumber', target_order.order_number,
    'orderStatus', target_order.order_status,
    'paymentStatus', target_order.payment_status,
    'fulfillmentStatus', target_order.fulfillment_status,
    'paymentMethod', target_order.payment_method,
    'paymentProvider', target_order.payment_provider,
    'providerPaymentStatus', target_order.provider_payment_status,
    'refundStatus', target_order.refund_status,
    'deliveryMethod', target_order.delivery_method,
    'currency', target_order.currency,
    'subtotal', target_order.subtotal,
    'shippingAmount', target_order.shipping_amount,
    'total', target_order.total,
    'reservationExpiresAt', target_order.reservation_expires_at,
    'paidAt', target_order.paid_at,
    'shippedAt', target_order.shipped_at,
    'completedAt', target_order.completed_at,
    'cancelledAt', target_order.cancelled_at,
    'expiredAt', target_order.expired_at,
    'refundedAt', target_order.refunded_at,
    'paymentUrl', case
      when target_order.payment_status = 'UNPAID'
       and target_order.payment_provider = 'STRIPE'
      then target_order.provider_checkout_url
      else null
    end,
    'customerProfileSnapshot', target_order.customer_profile_snapshot,
    'shippingAddressSnapshot', target_order.shipping_address_snapshot,
    'items', items_json,
    'shipment', shipment_json,
    'document', document_json,
    'warranties', warranties_json,
    'createdAt', target_order.created_at,
    'updatedAt', target_order.updated_at
  ));
end;
$$;

revoke all on function public.get_my_order_detail(uuid) from public, anon;
grant execute on function public.get_my_order_detail(uuid) to authenticated;
grant execute on function public.get_my_order_detail(uuid) to service_role;

comment on function public.get_my_order_detail(uuid) is
'SHOP-8.6: returns one read-only order with items, shipment, document and warranties only when auth.uid() owns it.';

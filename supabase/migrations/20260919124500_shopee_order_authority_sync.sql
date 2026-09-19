-- Shopee order push -> AMPHON System stock authority synchronization.
-- Webhook delivery is durable and retryable; Shopee never mutates Hub inventory directly.

alter table public.shopee_webhook_events
  add column if not exists status text not null default 'PENDING'
    check (status in ('PENDING','PROCESSING','DONE','FAILED','IGNORED')),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists shopee_webhook_order_due_idx
  on public.shopee_webhook_events(status, received_at)
  where status='PENDING' and code=3;

create table if not exists public.shopee_order_syncs (
  id uuid primary key default gen_random_uuid(),
  shop_id bigint not null,
  order_sn text not null,
  order_status text not null,
  skus jsonb not null default '[]'::jsonb,
  system_action text,
  system_outcome text,
  system_response jsonb,
  last_error text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shop_id, order_sn)
);

alter table public.shopee_order_syncs enable row level security;
revoke all on public.shopee_order_syncs from anon, authenticated;
grant all on public.shopee_order_syncs to service_role;

create or replace function public.claim_shopee_order_events(
  p_worker_id text,
  p_limit integer default 10
)
returns table(
  id uuid,
  shop_id bigint,
  code integer,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path=''
as $$
begin
  return query
  with due as (
    select e.id
    from public.shopee_webhook_events e
    where e.code=3
      and (
        e.status='PENDING'
        or (
          e.status='PROCESSING'
          and e.locked_at < now()-interval '10 minutes'
        )
      )
    order by e.received_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ),
  claimed as (
    update public.shopee_webhook_events e
       set status='PROCESSING',
           attempt_count=e.attempt_count+1,
           locked_at=now(),
           locked_by=left(coalesce(p_worker_id,'worker'),120),
           updated_at=now()
      from due
     where e.id=due.id
    returning e.id,e.shop_id,e.code,e.payload,e.attempt_count
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_shopee_order_events(text,integer)
  from public,anon,authenticated;
grant execute on function public.claim_shopee_order_events(text,integer)
  to service_role;

create or replace function public.complete_shopee_order_event(
  p_event_id uuid,
  p_worker_id text,
  p_status text default 'DONE'
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_status not in ('DONE','IGNORED') then
    raise exception 'SHOPEE_ORDER_EVENT_STATUS_INVALID';
  end if;

  update public.shopee_webhook_events
     set status=p_status,
         processed_at=now(),
         locked_at=null,
         locked_by=null,
         last_error=null,
         updated_at=now()
   where id=p_event_id
     and status='PROCESSING'
     and locked_by=left(coalesce(p_worker_id,'worker'),120);

  return found;
end;
$$;

revoke all on function public.complete_shopee_order_event(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.complete_shopee_order_event(uuid,text,text)
  to service_role;

create or replace function public.fail_shopee_order_event(
  p_event_id uuid,
  p_worker_id text,
  p_error text,
  p_retryable boolean default true
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_attempt integer;
  v_next_status text;
begin
  select attempt_count into v_attempt
  from public.shopee_webhook_events
  where id=p_event_id
    and status='PROCESSING'
    and locked_by=left(coalesce(p_worker_id,'worker'),120)
  for update;

  if v_attempt is null then return 'IGNORED'; end if;

  if not p_retryable or v_attempt >= 8 then
    v_next_status := 'FAILED';
    update public.shopee_webhook_events
       set status='FAILED',
           locked_at=null,
           locked_by=null,
           last_error=left(coalesce(p_error,'SHOPEE_ORDER_SYNC_FAILED'),1500),
           updated_at=now()
     where id=p_event_id;
  else
    v_next_status := 'PENDING';
    update public.shopee_webhook_events
       set status='PENDING',
           locked_at=null,
           locked_by=null,
           last_error=left(coalesce(p_error,'SHOPEE_ORDER_SYNC_FAILED'),1500),
           updated_at=now()
     where id=p_event_id;
  end if;

  return v_next_status;
end;
$$;

revoke all on function public.fail_shopee_order_event(uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.fail_shopee_order_event(uuid,text,text,boolean)
  to service_role;

comment on table public.shopee_order_syncs is
  'Audit projection of Shopee order status into AMPHON System stock authority commands.';

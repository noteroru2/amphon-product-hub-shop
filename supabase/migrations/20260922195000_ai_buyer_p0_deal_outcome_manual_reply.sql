-- P0 Deal Outcome Ledger + Final Deal Label + Manual Reply Capture
-- Keeps AI paused while turning human operations into auditable learning data.

alter table public.ai_buyer_learning_labels
  add column if not exists source_ref text;

create unique index if not exists ai_buyer_learning_labels_source_ref_unique
  on public.ai_buyer_learning_labels(window_id,label_type,source_ref)
  where source_ref is not null;

-- Manual replies are a first-class outbound action.
alter table public.ai_buyer_outbound_actions
  drop constraint if exists ai_buyer_outbound_actions_action_type_check;

alter table public.ai_buyer_outbound_actions
  add constraint ai_buyer_outbound_actions_action_type_check
  check (action_type = any (array[
    'OFFER'::text,
    'NEGOTIATION_REPLY'::text,
    'FULFILLMENT_PROMPT'::text,
    'FULFILLMENT_COMPLETE'::text,
    'MANUAL_REPLY'::text
  ]));

create table if not exists public.ai_buyer_case_outcomes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.ai_buyer_valuation_cases(id) on delete cascade,
  final_label text not null check (final_label in (
    'AGREED_PENDING_HANDOVER',
    'PURCHASED',
    'CUSTOMER_DECLINED_PRICE',
    'CUSTOMER_NO_RESPONSE',
    'SOLD_ELSEWHERE',
    'CONDITION_REJECTED',
    'IDENTITY_MISMATCH',
    'OWNERSHIP_RISK',
    'OUTSIDE_POLICY',
    'CANCELLED_OTHER'
  )),
  final_agreed_price numeric check (final_agreed_price is null or final_agreed_price >= 0),
  purchase_price numeric check (purchase_price is null or purchase_price >= 0),
  reason_code text,
  note text,
  outcome_at timestamptz not null default now(),
  labeled_by uuid,
  source text not null default 'MANUAL_OWNER'
    check (source in ('MANUAL_OWNER','MANUAL_ADMIN','SYSTEM_SYNC')),
  verified boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (final_label <> 'AGREED_PENDING_HANDOVER' or final_agreed_price is not null)
    and (final_label <> 'PURCHASED' or coalesce(purchase_price,final_agreed_price) is not null)
  )
);

create index if not exists ai_buyer_case_outcomes_label_idx
  on public.ai_buyer_case_outcomes(final_label,outcome_at desc);

create table if not exists public.ai_buyer_deal_ledger (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  line_no smallint not null default 1 check (line_no between 1 and 100),
  product_id uuid references public.products(id) on delete set null,
  item_title text,
  category text,
  model text,
  sku text,
  status text not null default 'PENDING' check (status in (
    'PENDING','ACQUIRED','IN_STOCK','SOLD','RETURNED','WRITE_OFF','CANCELLED'
  )),
  purchase_price numeric check (purchase_price is null or purchase_price >= 0),
  acquired_at timestamptz,
  repair_cost numeric not null default 0 check (repair_cost >= 0),
  parts_cost numeric not null default 0 check (parts_cost >= 0),
  transport_cost numeric not null default 0 check (transport_cost >= 0),
  warranty_cost numeric not null default 0 check (warranty_cost >= 0),
  channel_fee numeric not null default 0 check (channel_fee >= 0),
  other_cost numeric not null default 0 check (other_cost >= 0),
  sale_price numeric check (sale_price is null or sale_price >= 0),
  sale_channel text,
  sold_at timestamptz,
  sale_price_source text not null default 'UNKNOWN' check (sale_price_source in (
    'UNKNOWN','MANUAL_VERIFIED','COMMERCE_ORDER','PRODUCT_SOLD_PRICE'
  )),
  sale_price_verified boolean not null default false,
  note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  total_cost numeric generated always as (
    coalesce(purchase_price,0)
    + repair_cost + parts_cost + transport_cost
    + warranty_cost + channel_fee + other_cost
  ) stored,
  gross_profit numeric generated always as (
    case when sale_price is null then null
      else sale_price - (
        coalesce(purchase_price,0)
        + repair_cost + parts_cost + transport_cost
        + warranty_cost + channel_fee + other_cost
      )
    end
  ) stored,
  unique(case_id,line_no)
);

create unique index if not exists ai_buyer_deal_ledger_product_unique
  on public.ai_buyer_deal_ledger(product_id)
  where product_id is not null;

create index if not exists ai_buyer_deal_ledger_case_status_idx
  on public.ai_buyer_deal_ledger(case_id,status);

alter table public.ai_buyer_case_outcomes enable row level security;
alter table public.ai_buyer_deal_ledger enable row level security;

revoke all on public.ai_buyer_case_outcomes from public,anon,authenticated;
revoke all on public.ai_buyer_deal_ledger from public,anon,authenticated;
grant select,insert,update,delete on public.ai_buyer_case_outcomes to service_role;
grant select,insert,update,delete on public.ai_buyer_deal_ledger to service_role;

create or replace view public.ai_buyer_deal_ledger_case_v
with (security_invoker=false) as
select
  c.id as case_id,
  c.title,
  c.category,
  o.final_label,
  o.final_agreed_price,
  o.purchase_price as outcome_purchase_price,
  o.outcome_at,
  count(l.id)::int as ledger_lines,
  coalesce(sum(l.purchase_price),0)::numeric as purchase_total,
  coalesce(sum(l.repair_cost),0)::numeric as repair_total,
  coalesce(sum(l.parts_cost),0)::numeric as parts_total,
  coalesce(sum(l.transport_cost),0)::numeric as transport_total,
  coalesce(sum(l.warranty_cost),0)::numeric as warranty_total,
  coalesce(sum(l.channel_fee),0)::numeric as channel_fee_total,
  coalesce(sum(l.other_cost),0)::numeric as other_cost_total,
  coalesce(sum(l.total_cost),0)::numeric as total_cost,
  case when count(l.id) filter (where l.sale_price is not null) = 0
    then null else sum(l.sale_price) end as sale_total,
  case when count(l.id) filter (where l.gross_profit is not null) = 0
    then null else sum(l.gross_profit) end as gross_profit,
  min(l.acquired_at) as first_acquired_at,
  max(l.sold_at) as last_sold_at,
  count(l.id) filter (where l.status='SOLD')::int as sold_lines,
  count(l.id) filter (where l.status in ('ACQUIRED','IN_STOCK'))::int as in_stock_lines
from public.ai_buyer_valuation_cases c
left join public.ai_buyer_case_outcomes o on o.case_id=c.id
left join public.ai_buyer_deal_ledger l on l.case_id=c.id
group by c.id,c.title,c.category,o.final_label,o.final_agreed_price,o.purchase_price,o.outcome_at;

revoke all on public.ai_buyer_deal_ledger_case_v from public,anon,authenticated;
grant select on public.ai_buyer_deal_ledger_case_v to service_role;

create or replace function public.ai_buyer_touch_outcome_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_case_outcomes_touch on public.ai_buyer_case_outcomes;
create trigger trg_ai_buyer_case_outcomes_touch
before update on public.ai_buyer_case_outcomes
for each row execute function public.ai_buyer_touch_outcome_updated_at();

drop trigger if exists trg_ai_buyer_deal_ledger_touch on public.ai_buyer_deal_ledger;
create trigger trg_ai_buyer_deal_ledger_touch
before update on public.ai_buyer_deal_ledger
for each row execute function public.ai_buyer_touch_outcome_updated_at();

create or replace function public.ai_buyer_apply_final_outcome()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_state text;
  v_price numeric;
  v_title text;
  v_category text;
  w record;
  v_label_type text;
begin
  v_price := coalesce(new.purchase_price,new.final_agreed_price);

  v_state := case new.final_label
    when 'AGREED_PENDING_HANDOVER' then 'ACCEPTED'
    when 'PURCHASED' then 'COMPLETED'
    when 'CUSTOMER_DECLINED_PRICE' then 'CUSTOMER_DECLINED'
    when 'CUSTOMER_NO_RESPONSE' then 'EXPIRED'
    when 'SOLD_ELSEWHERE' then 'CUSTOMER_DECLINED'
    else 'CANCELLED'
  end;

  update public.ai_buyer_valuation_cases c
  set state=v_state,
      control_mode='HUMAN_ACTIVE',
      accepted_price=case
        when new.final_label in ('AGREED_PENDING_HANDOVER','PURCHASED') then v_price
        else c.accepted_price
      end,
      accepted_at=case
        when new.final_label in ('AGREED_PENDING_HANDOVER','PURCHASED')
          then coalesce(c.accepted_at,new.outcome_at)
        else c.accepted_at
      end,
      completed_at=case
        when v_state in ('COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
          then coalesce(c.completed_at,new.outcome_at)
        else c.completed_at
      end,
      metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
        'finalDealLabel',new.final_label,
        'finalDealOutcomeId',new.id,
        'finalDealLabeledAt',new.outcome_at,
        'finalDealVerified',new.verified
      ),
      updated_at=now()
  where c.id=new.case_id
  returning c.title,c.category into v_title,v_category;

  if new.final_label='PURCHASED' then
    insert into public.ai_buyer_deal_ledger(
      case_id,line_no,item_title,category,status,purchase_price,acquired_at,created_by,updated_by
    ) values (
      new.case_id,1,v_title,v_category,'ACQUIRED',v_price,new.outcome_at,new.labeled_by,new.labeled_by
    )
    on conflict (case_id,line_no) do update
      set purchase_price=coalesce(public.ai_buyer_deal_ledger.purchase_price,excluded.purchase_price),
          acquired_at=coalesce(public.ai_buyer_deal_ledger.acquired_at,excluded.acquired_at),
          status=case
            when public.ai_buyer_deal_ledger.status='PENDING' then 'ACQUIRED'
            else public.ai_buyer_deal_ledger.status
          end,
          updated_by=coalesce(excluded.updated_by,public.ai_buyer_deal_ledger.updated_by),
          updated_at=now();
  end if;

  v_label_type := case
    when new.final_label in ('AGREED_PENDING_HANDOVER','PURCHASED') then 'CUSTOMER_ACCEPTED'
    else 'CUSTOMER_DECLINED'
  end;

  for w in
    select distinct le.window_id
    from public.ai_buyer_learning_events le
    where le.case_id=new.case_id
  loop
    insert into public.ai_buyer_learning_labels(
      window_id,conversation_id,case_id,label_type,payload,confidence,verified,source_event_ids,source_ref
    )
    select
      w.window_id,
      c.conversation_id,
      new.case_id,
      v_label_type,
      jsonb_build_object(
        'finalLabel',new.final_label,
        'finalAgreedPrice',new.final_agreed_price,
        'purchasePrice',new.purchase_price,
        'reasonCode',new.reason_code,
        'outcomeAt',new.outcome_at,
        'source',new.source
      ),
      1.0,
      new.verified,
      '{}'::uuid[],
      'CASE_OUTCOME:' || new.id::text
    from public.ai_buyer_valuation_cases c
    where c.id=new.case_id
    on conflict (window_id,label_type,source_ref)
      where source_ref is not null
      do update set
        payload=excluded.payload,
        confidence=excluded.confidence,
        verified=excluded.verified;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_apply_final_outcome on public.ai_buyer_case_outcomes;
create trigger trg_ai_buyer_apply_final_outcome
after insert or update on public.ai_buyer_case_outcomes
for each row execute function public.ai_buyer_apply_final_outcome();

-- Reclassify learning capture so messages sent from the Hub are owner-manual exemplars.
create or replace function public.ai_buyer_capture_learning_message()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  w record;
  v_at timestamptz;
  v_speaker text;
begin
  v_at := coalesce(new.line_timestamp,new.created_at,now());

  for w in
    select id
    from public.ai_buyer_learning_windows
    where status='CAPTURING'
      and v_at >= starts_at
      and v_at < ends_at
  loop
    v_speaker := case
      when new.direction='INBOUND' then 'CUSTOMER'
      when new.direction='OUTBOUND' and coalesce(new.metadata->>'source','')='OWNER_MANUAL'
        then 'OWNER_MANUAL'
      when new.direction='OUTBOUND' and coalesce(new.metadata->>'source','')='ADMIN_APPROVAL'
        then 'OWNER_APPROVED'
      when new.direction='OUTBOUND' and coalesce(new.metadata->>'source','') in ('AI','AI_BUYER','AUTOMATION')
        then 'AI_SYSTEM'
      when new.direction='OUTBOUND' then 'SHOP_OTHER'
      else 'UNKNOWN'
    end;

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
      v_speaker,
      new.message_type,
      new.text_content,
      v_at,
      jsonb_build_object(
        'line_message_id',new.line_message_id,
        'webhook_event_id',new.webhook_event_id,
        'metadata',coalesce(new.metadata,'{}'::jsonb)
      ),
      'PENDING'
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

create or replace function public.ai_buyer_prepare_manual_reply(
  p_case_id uuid,
  p_actor_user_id uuid,
  p_actor_name text,
  p_text text,
  p_offer_amount numeric,
  p_idempotency_key text
)
returns table(
  action_id uuid,
  conversation_id uuid,
  line_user_id text,
  action_status text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_case record;
  v_action public.ai_buyer_outbound_actions%rowtype;
begin
  if nullif(trim(coalesce(p_text,'')),'') is null then
    raise exception 'MANUAL_REPLY_TEXT_REQUIRED';
  end if;
  if length(p_text) > 4500 then
    raise exception 'MANUAL_REPLY_TEXT_TOO_LONG';
  end if;
  if p_offer_amount is not null and p_offer_amount < 0 then
    raise exception 'MANUAL_REPLY_OFFER_INVALID';
  end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'MANUAL_REPLY_IDEMPOTENCY_REQUIRED';
  end if;

  select c.id,c.conversation_id,conv.line_user_id,c.state
  into v_case
  from public.ai_buyer_valuation_cases c
  join public.ai_buyer_conversations conv on conv.id=c.conversation_id
  where c.id=p_case_id
  for update;

  if v_case.id is null then
    raise exception 'MANUAL_REPLY_CASE_NOT_FOUND';
  end if;

  insert into public.ai_buyer_outbound_actions(
    conversation_id,case_id,action_type,idempotency_key,status,payload
  ) values (
    v_case.conversation_id,
    p_case_id,
    'MANUAL_REPLY',
    p_idempotency_key,
    'PENDING',
    jsonb_build_object(
      'text',p_text,
      'actorUserId',p_actor_user_id,
      'actorName',coalesce(p_actor_name,'Owner'),
      'offerAmount',p_offer_amount,
      'preparedAt',now()
    )
  )
  on conflict (idempotency_key) do update
    set payload=public.ai_buyer_outbound_actions.payload
  returning * into v_action;

  update public.ai_buyer_valuation_cases
  set control_mode='HUMAN_ACTIVE',updated_at=now()
  where id=p_case_id;

  update public.ai_buyer_conversations
  set control_mode='HUMAN_ACTIVE',updated_at=now()
  where id=v_case.conversation_id;

  return query
  select v_action.id,v_case.conversation_id,v_case.line_user_id,v_action.status;
end;
$$;

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
    conversation_id,case_id,direction,message_type,text_content,metadata,line_timestamp
  ) values (
    a.conversation_id,a.case_id,'OUTBOUND','TEXT',v_text,
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

create or replace function public.ai_buyer_fail_manual_reply(
  p_action_id uuid,
  p_error text
)
returns void
language sql
security definer
set search_path=public
as $$
  update public.ai_buyer_outbound_actions
  set status='FAILED',error=left(coalesce(p_error,'UNKNOWN_ERROR'),2000)
  where id=p_action_id
    and action_type='MANUAL_REPLY'
    and status<>'SENT';
$$;

create or replace function public.ai_buyer_sync_deal_ledger(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  l record;
  p record;
  v_online record;
begin
  for l in
    select * from public.ai_buyer_deal_ledger where case_id=p_case_id
  loop
    if l.product_id is null then
      continue;
    end if;

    select
      pr.id,pr.sku,pr.title,pr.category,pr.model,pr.status,pr.price,pr.sold_at,
      pf.cost
    into p
    from public.products pr
    left join public.product_financials pf on pf.product_id=pr.id
    where pr.id=l.product_id;

    if p.id is null then
      continue;
    end if;

    select oi.unit_price,o.completed_at,o.order_number
    into v_online
    from public.commerce_order_items oi
    join public.commerce_orders o on o.id=oi.order_id
    where oi.product_id=p.id
      and o.order_status='COMPLETED'
    order by o.completed_at desc nulls last,o.created_at desc
    limit 1;

    update public.ai_buyer_deal_ledger
    set sku=coalesce(sku,p.sku),
        item_title=coalesce(item_title,p.title),
        category=coalesce(category,p.category),
        model=coalesce(model,p.model),
        purchase_price=coalesce(purchase_price,p.cost),
        status=case
          when v_online.unit_price is not null then 'SOLD'
          when p.status='sold' then 'SOLD'
          when status='ACQUIRED' and p.status in ('published','ready_to_list','photo_ready') then 'IN_STOCK'
          else status
        end,
        sale_price=case
          when sale_price_source='MANUAL_VERIFIED' then sale_price
          when v_online.unit_price is not null then v_online.unit_price
          when p.status='sold' and p.price is not null then p.price
          else sale_price
        end,
        sold_at=case
          when sale_price_source='MANUAL_VERIFIED' then sold_at
          when v_online.unit_price is not null then coalesce(v_online.completed_at,sold_at)
          when p.status='sold' then coalesce(p.sold_at,sold_at)
          else sold_at
        end,
        sale_channel=case
          when sale_price_source='MANUAL_VERIFIED' then sale_channel
          when v_online.unit_price is not null then 'WEBSITE'
          when p.status='sold' then coalesce(sale_channel,'HUB_MANUAL')
          else sale_channel
        end,
        sale_price_source=case
          when sale_price_source='MANUAL_VERIFIED' then sale_price_source
          when v_online.unit_price is not null then 'COMMERCE_ORDER'
          when p.status='sold' and p.price is not null then 'PRODUCT_SOLD_PRICE'
          else sale_price_source
        end,
        sale_price_verified=case
          when sale_price_source='MANUAL_VERIFIED' then true
          when v_online.unit_price is not null then true
          else sale_price_verified
        end,
        updated_at=now()
    where id=l.id;
  end loop;

  return (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.line_no),'[]'::jsonb)
    from public.ai_buyer_deal_ledger x
    where x.case_id=p_case_id
  );
end;
$$;

create or replace function public.ai_buyer_sync_ledger_from_product()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
begin
  for r in select distinct case_id from public.ai_buyer_deal_ledger where product_id=new.id
  loop
    perform public.ai_buyer_sync_deal_ledger(r.case_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_sync_ledger_product on public.products;
create trigger trg_ai_buyer_sync_ledger_product
after update of status,price,sold_at,sku,title,category,model on public.products
for each row execute function public.ai_buyer_sync_ledger_from_product();

create or replace function public.ai_buyer_sync_ledger_from_financial()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
begin
  for r in select distinct case_id from public.ai_buyer_deal_ledger where product_id=new.product_id
  loop
    perform public.ai_buyer_sync_deal_ledger(r.case_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_sync_ledger_financial on public.product_financials;
create trigger trg_ai_buyer_sync_ledger_financial
after insert or update of cost on public.product_financials
for each row execute function public.ai_buyer_sync_ledger_from_financial();

create or replace function public.ai_buyer_sync_ledger_from_order()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
begin
  if new.order_status='COMPLETED' then
    for r in
      select distinct l.case_id
      from public.commerce_order_items oi
      join public.ai_buyer_deal_ledger l on l.product_id=oi.product_id
      where oi.order_id=new.id
    loop
      perform public.ai_buyer_sync_deal_ledger(r.case_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_sync_ledger_order on public.commerce_orders;
create trigger trg_ai_buyer_sync_ledger_order
after update of order_status,completed_at on public.commerce_orders
for each row execute function public.ai_buyer_sync_ledger_from_order();

revoke all on function public.ai_buyer_prepare_manual_reply(uuid,uuid,text,text,numeric,text) from public,anon,authenticated;
revoke all on function public.ai_buyer_finalize_manual_reply(uuid,text) from public,anon,authenticated;
revoke all on function public.ai_buyer_fail_manual_reply(uuid,text) from public,anon,authenticated;
revoke all on function public.ai_buyer_sync_deal_ledger(uuid) from public,anon,authenticated;

grant execute on function public.ai_buyer_prepare_manual_reply(uuid,uuid,text,text,numeric,text) to service_role;
grant execute on function public.ai_buyer_finalize_manual_reply(uuid,text) to service_role;
grant execute on function public.ai_buyer_fail_manual_reply(uuid,text) to service_role;
grant execute on function public.ai_buyer_sync_deal_ledger(uuid) to service_role;

comment on table public.ai_buyer_case_outcomes is
  'Verified final deal label for AI Buyer learning: acceptance/purchase/lost-deal reason.';
comment on table public.ai_buyer_deal_ledger is
  'Per-item acquisition-to-sale economics used to learn profitable buy prices.';
comment on function public.ai_buyer_prepare_manual_reply(uuid,uuid,text,text,numeric,text) is
  'Prepares an owner/admin LINE manual reply with audit/idempotency before LINE push.';
comment on function public.ai_buyer_finalize_manual_reply(uuid,text) is
  'Archives a successfully delivered owner manual LINE reply and learning labels.';

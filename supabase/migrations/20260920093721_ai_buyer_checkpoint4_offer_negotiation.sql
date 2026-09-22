-- AMPHON AI Buyer V1 — Checkpoint 4: Offer + Negotiation + Acceptance + Fulfillment

alter table public.ai_buyer_offers
  add column if not exists idempotency_key text,
  add column if not exists round_no integer not null default 0 check (round_no between 0 and 20),
  add column if not exists delivered_at timestamptz;

create unique index if not exists ai_buyer_offers_idempotency_idx
  on public.ai_buyer_offers(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.ai_buyer_category_automation_modes (
  category text primary key
    check (category in ('NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER')),
  mode text not null default 'SHADOW'
    check (mode in ('SHADOW','APPROVAL','AUTO')),
  max_negotiation_rounds integer not null default 4
    check (max_negotiation_rounds between 1 and 10),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.ai_buyer_category_automation_modes(category, mode)
values
  ('NOTEBOOK','SHADOW'),('MACBOOK','SHADOW'),('DESKTOP_PC','SHADOW'),
  ('SMARTPHONE','SHADOW'),('TABLET','SHADOW'),('CAMERA','SHADOW'),('OTHER','SHADOW')
on conflict (category) do nothing;

drop trigger if exists ai_buyer_automation_modes_touch on public.ai_buyer_category_automation_modes;
create trigger ai_buyer_automation_modes_touch
before update on public.ai_buyer_category_automation_modes
for each row execute function public.ai_buyer_touch_updated_at();

create table if not exists public.ai_buyer_negotiation_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  pricing_decision_id uuid references public.ai_buyer_pricing_decisions(id) on delete set null,
  offer_id uuid references public.ai_buyer_offers(id) on delete set null,
  inbound_message_id uuid references public.ai_buyer_messages(id) on delete set null,
  event_type text not null
    check (event_type in (
      'INITIAL_OFFER','CUSTOMER_COUNTER','SHOP_CONCESSION','ACCEPTANCE','DECLINE',
      'FULFILLMENT_UPDATE','ROLLOUT_BLOCKED','HUMAN_HANDOFF'
    )),
  customer_amount numeric(12,2) check (customer_amount is null or customer_amount >= 0),
  shop_amount numeric(12,2) check (shop_amount is null or shop_amount >= 0),
  attempt_no integer not null default 0 check (attempt_no between 0 and 20),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_buyer_negotiation_case_idx
  on public.ai_buyer_negotiation_events(case_id, created_at desc);
create index if not exists ai_buyer_negotiation_decision_idx
  on public.ai_buyer_negotiation_events(pricing_decision_id);
create index if not exists ai_buyer_negotiation_offer_idx
  on public.ai_buyer_negotiation_events(offer_id);
create index if not exists ai_buyer_negotiation_message_idx
  on public.ai_buyer_negotiation_events(inbound_message_id);

create table if not exists public.ai_buyer_outbound_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_buyer_conversations(id) on delete cascade,
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  offer_id uuid references public.ai_buyer_offers(id) on delete set null,
  action_type text not null
    check (action_type in ('OFFER','NEGOTIATION_REPLY','FULFILLMENT_PROMPT','FULFILLMENT_COMPLETE')),
  idempotency_key text not null unique,
  status text not null default 'PENDING'
    check (status in ('PENDING','SENT','FAILED','CANCELLED')),
  payload jsonb not null default '{}'::jsonb,
  line_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists ai_buyer_outbound_case_status_idx
  on public.ai_buyer_outbound_actions(case_id, status, created_at desc);
create index if not exists ai_buyer_outbound_conversation_idx
  on public.ai_buyer_outbound_actions(conversation_id);
create index if not exists ai_buyer_outbound_offer_idx
  on public.ai_buyer_outbound_actions(offer_id);

create table if not exists public.ai_buyer_fulfillment_details (
  case_id uuid primary key references public.ai_buyer_valuation_cases(id) on delete cascade,
  customer_name text,
  phone text,
  method text check (method is null or method in ('PICKUP','SHIP','STORE_DROP')),
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  location_title text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ai_buyer_fulfillment_touch on public.ai_buyer_fulfillment_details;
create trigger ai_buyer_fulfillment_touch
before update on public.ai_buyer_fulfillment_details
for each row execute function public.ai_buyer_touch_updated_at();

create or replace function public.ai_buyer_create_guarded_offer(
  p_case_id uuid,
  p_decision_id uuid,
  p_amount numeric,
  p_actor text,
  p_idempotency_key text,
  p_round_no integer default 0,
  p_message_id uuid default null
)
returns table(id uuid, amount numeric)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_case_state text;
  v_case_accepted_at timestamptz;
  v_hard_max numeric(12,2);
  v_current numeric(12,2);
  v_confidence numeric;
  v_decision_case uuid;
  v_existing public.ai_buyer_offers%rowtype;
  v_offer public.ai_buyer_offers%rowtype;
begin
  if p_actor not in ('AI','ADMIN') then raise exception 'AI_BUYER_OFFER_ACTOR_INVALID'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'AI_BUYER_OFFER_AMOUNT_INVALID'; end if;
  if coalesce(trim(p_idempotency_key),'') = '' then raise exception 'AI_BUYER_OFFER_IDEMPOTENCY_REQUIRED'; end if;

  select vc.state, vc.accepted_at into v_case_state, v_case_accepted_at
  from public.ai_buyer_valuation_cases vc
  where vc.id = p_case_id
  for update;

  if not found then raise exception 'AI_BUYER_CASE_NOT_FOUND'; end if;
  if v_case_accepted_at is not null
     or v_case_state in ('ACCEPTED','COLLECTING_FULFILLMENT','ACTION_REQUIRED','ADMIN_ASSIGNED','COMPLETED','CUSTOMER_DECLINED','EXPIRED','CANCELLED')
  then raise exception 'AI_BUYER_NEGOTIATION_CLOSED'; end if;

  select pd.case_id, pd.hard_max, pd.current_authorized_offer, pd.pricing_confidence
  into v_decision_case, v_hard_max, v_current, v_confidence
  from public.ai_buyer_pricing_decisions pd
  where pd.id = p_decision_id
  for update;

  if not found or v_decision_case is distinct from p_case_id then raise exception 'AI_BUYER_PRICING_DECISION_INVALID'; end if;
  if v_confidence < 0.85 then raise exception 'AI_BUYER_PRICING_CONFIDENCE_LOW'; end if;
  if p_amount > v_hard_max then raise exception 'AI_BUYER_HARD_MAX_EXCEEDED'; end if;
  if p_amount < v_current then raise exception 'AI_BUYER_OFFER_MUST_BE_MONOTONIC'; end if;

  select o.* into v_existing
  from public.ai_buyer_offers o
  where o.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.case_id <> p_case_id
       or v_existing.pricing_decision_id <> p_decision_id
       or v_existing.amount <> p_amount
    then raise exception 'AI_BUYER_OFFER_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id, v_existing.amount;
    return;
  end if;

  insert into public.ai_buyer_offers(
    case_id, pricing_decision_id, amount, actor, status, message_id,
    idempotency_key, round_no
  ) values (
    p_case_id, p_decision_id, round(p_amount), p_actor, 'PROPOSED', p_message_id,
    p_idempotency_key, greatest(0, coalesce(p_round_no,0))
  )
  returning * into v_offer;

  update public.ai_buyer_offers o
  set status = 'SUPERSEDED'
  where o.case_id = p_case_id
    and o.status = 'PROPOSED'
    and o.id <> v_offer.id;

  update public.ai_buyer_pricing_decisions pd
  set current_authorized_offer = greatest(pd.current_authorized_offer, round(p_amount))
  where pd.id = p_decision_id;

  return query select v_offer.id, v_offer.amount;
end;
$fn$;

create or replace function public.ai_buyer_accept_offer(
  p_case_id uuid,
  p_offer_id uuid,
  p_inbound_message_id uuid default null
)
returns table(offer_id uuid, agreed_price numeric)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_case public.ai_buyer_valuation_cases%rowtype;
  v_offer public.ai_buyer_offers%rowtype;
begin
  select * into v_case from public.ai_buyer_valuation_cases where id = p_case_id for update;
  if not found then raise exception 'AI_BUYER_CASE_NOT_FOUND'; end if;

  if v_case.accepted_at is not null then
    select * into v_offer from public.ai_buyer_offers where id = p_offer_id;
    if found and v_offer.case_id = p_case_id and v_offer.amount = v_case.accepted_price then
      return query select v_offer.id, v_offer.amount;
      return;
    end if;
    raise exception 'AI_BUYER_NEGOTIATION_ALREADY_ACCEPTED';
  end if;

  if v_case.state not in ('OFFERED','NEGOTIATING') then raise exception 'AI_BUYER_CASE_NOT_OFFERED'; end if;

  select * into v_offer from public.ai_buyer_offers where id = p_offer_id for update;
  if not found
     or v_offer.case_id <> p_case_id
     or v_offer.actor not in ('AI','ADMIN')
     or v_offer.status <> 'PROPOSED'
     or v_offer.delivered_at is null
  then raise exception 'AI_BUYER_ACCEPTABLE_OFFER_NOT_FOUND'; end if;

  update public.ai_buyer_offers set status = 'ACCEPTED' where id = p_offer_id;
  update public.ai_buyer_offers set status = 'SUPERSEDED'
  where case_id = p_case_id and id <> p_offer_id and status = 'PROPOSED';

  update public.ai_buyer_valuation_cases
  set state = 'COLLECTING_FULFILLMENT',
      accepted_price = v_offer.amount,
      accepted_at = now()
  where id = p_case_id;

  insert into public.ai_buyer_negotiation_events(
    case_id, pricing_decision_id, offer_id, inbound_message_id,
    event_type, shop_amount, attempt_no
  ) values (
    p_case_id, v_offer.pricing_decision_id, v_offer.id, p_inbound_message_id,
    'ACCEPTANCE', v_offer.amount, v_offer.round_no
  );

  return query select v_offer.id, v_offer.amount;
end;
$fn$;

alter table public.ai_buyer_category_automation_modes enable row level security;
alter table public.ai_buyer_negotiation_events enable row level security;
alter table public.ai_buyer_outbound_actions enable row level security;
alter table public.ai_buyer_fulfillment_details enable row level security;

revoke all on table
  public.ai_buyer_category_automation_modes,
  public.ai_buyer_negotiation_events,
  public.ai_buyer_outbound_actions,
  public.ai_buyer_fulfillment_details
from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_buyer_category_automation_modes,
  public.ai_buyer_negotiation_events,
  public.ai_buyer_outbound_actions,
  public.ai_buyer_fulfillment_details
to service_role;

revoke all on function public.ai_buyer_create_guarded_offer(uuid,uuid,numeric,text,text,integer,uuid) from public, anon, authenticated;
revoke all on function public.ai_buyer_accept_offer(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ai_buyer_create_guarded_offer(uuid,uuid,numeric,text,text,integer,uuid) to service_role;
grant execute on function public.ai_buyer_accept_offer(uuid,uuid,uuid) to service_role;

comment on table public.ai_buyer_category_automation_modes is
  'Checkpoint 4 rollout control. Defaults SHADOW; switch categories explicitly to APPROVAL or AUTO.';
comment on table public.ai_buyer_negotiation_events is
  'Auditable negotiation events including counters, concessions, acceptance, decline, and fulfillment updates.';
comment on table public.ai_buyer_outbound_actions is
  'Idempotent outbound LINE actions used to prevent duplicate offer/negotiation messages.';
comment on function public.ai_buyer_create_guarded_offer(uuid,uuid,numeric,text,text,integer,uuid) is
  'Transactional offer creation: idempotent, monotonic and hard-max guarded.';
comment on function public.ai_buyer_accept_offer(uuid,uuid,uuid) is
  'Atomically accepts only a delivered current shop offer and closes price negotiation.';

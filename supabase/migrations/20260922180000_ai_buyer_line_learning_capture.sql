-- LINE learning capture window: 5-day owner-style / price-learning corpus.
-- Start: 2026-09-22 18:00 Asia/Bangkok
-- End:   2026-09-27 18:00 Asia/Bangkok
-- OpenAI remains paused; this schema only archives deterministic LINE/chat evidence.

create table if not exists public.ai_buyer_learning_windows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text not null default 'PRICE_AND_CONVERSATION_STYLE',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'CAPTURING'
    check (status in ('CAPTURING','CLOSED','PROCESSING','PROCESSED','CANCELLED')),
  source_policy text not null default 'LINE_5D_OWNER_MANUAL_V1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.ai_buyer_learning_events (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.ai_buyer_learning_windows(id) on delete cascade,
  source text not null
    check (source in ('AI_BUYER_MESSAGE','LINE_OA_CHAT_EXPORT','MANUAL_IMPORT')),
  source_external_id text,
  conversation_id uuid references public.ai_buyer_conversations(id) on delete set null,
  case_id uuid references public.ai_buyer_valuation_cases(id) on delete set null,
  direction text not null
    check (direction in ('INBOUND','OUTBOUND','UNKNOWN')),
  speaker text not null
    check (speaker in ('CUSTOMER','OWNER_MANUAL','OWNER_APPROVED','AI_SYSTEM','SHOP_OTHER','UNKNOWN')),
  message_type text not null default 'TEXT',
  text_content text,
  occurred_at timestamptz not null,
  raw_payload jsonb not null default '{}'::jsonb,
  pii_redaction_status text not null default 'PENDING'
    check (pii_redaction_status in ('PENDING','REDACTED','NOT_REQUIRED')),
  created_at timestamptz not null default now()
);

create unique index if not exists ai_buyer_learning_events_source_unique
  on public.ai_buyer_learning_events(window_id,source,source_external_id)
  where source_external_id is not null;

create index if not exists ai_buyer_learning_events_window_time_idx
  on public.ai_buyer_learning_events(window_id,occurred_at);

create index if not exists ai_buyer_learning_events_conversation_idx
  on public.ai_buyer_learning_events(window_id,conversation_id,occurred_at);

create table if not exists public.ai_buyer_learning_imports (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.ai_buyer_learning_windows(id) on delete cascade,
  source text not null default 'LINE_OA_CHAT_EXPORT',
  file_name text,
  storage_key text not null,
  byte_size bigint,
  sha256 text,
  parse_status text not null default 'RAW_STORED'
    check (parse_status in ('RAW_STORED','PARSED','FAILED')),
  rows_parsed integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  parsed_at timestamptz,
  error text
);

create table if not exists public.ai_buyer_learning_line_delivery_stats (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.ai_buyer_learning_windows(id) on delete cascade,
  stat_date date not null,
  chat_messages integer,
  api_reply integer,
  api_push integer,
  api_multicast integer,
  api_broadcast integer,
  auto_response integer,
  welcome_response integer,
  raw_payload jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  unique(window_id,stat_date)
);

create table if not exists public.ai_buyer_learning_labels (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.ai_buyer_learning_windows(id) on delete cascade,
  conversation_id uuid references public.ai_buyer_conversations(id) on delete set null,
  case_id uuid references public.ai_buyer_valuation_cases(id) on delete set null,
  label_type text not null
    check (label_type in (
      'PRICE_QUOTE','NEGOTIATION_MOVE','CUSTOMER_ACCEPTED','CUSTOMER_DECLINED',
      'CLOSING_MOVE','OBJECTION_HANDLING','PRODUCT_FACT','CONDITION_FACT','FULFILLMENT'
    )),
  payload jsonb not null default '{}'::jsonb,
  confidence numeric,
  verified boolean not null default false,
  source_event_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

revoke all on public.ai_buyer_learning_windows from public,anon,authenticated;
revoke all on public.ai_buyer_learning_events from public,anon,authenticated;
revoke all on public.ai_buyer_learning_imports from public,anon,authenticated;
revoke all on public.ai_buyer_learning_line_delivery_stats from public,anon,authenticated;
revoke all on public.ai_buyer_learning_labels from public,anon,authenticated;

grant select,insert,update,delete on public.ai_buyer_learning_windows to service_role;
grant select,insert,update,delete on public.ai_buyer_learning_events to service_role;
grant select,insert,update,delete on public.ai_buyer_learning_imports to service_role;
grant select,insert,update,delete on public.ai_buyer_learning_line_delivery_stats to service_role;
grant select,insert,update,delete on public.ai_buyer_learning_labels to service_role;

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
      when new.direction='OUTBOUND' and coalesce(new.metadata->>'source','')='ADMIN_APPROVAL'
        then 'OWNER_APPROVED'
      when new.direction='OUTBOUND' and coalesce(new.metadata->>'source','') in ('AI','AI_BUYER','AUTOMATION')
        then 'AI_SYSTEM'
      when new.direction='OUTBOUND' then 'SHOP_OTHER'
      else 'UNKNOWN'
    end;

    insert into public.ai_buyer_learning_events(
      window_id,source,source_external_id,conversation_id,case_id,
      direction,speaker,message_type,text_content,occurred_at,raw_payload
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
      )
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_ai_buyer_capture_learning_message on public.ai_buyer_messages;
create trigger trg_ai_buyer_capture_learning_message
after insert on public.ai_buyer_messages
for each row execute function public.ai_buyer_capture_learning_message();

revoke all on function public.ai_buyer_capture_learning_message() from public,anon,authenticated;
grant execute on function public.ai_buyer_capture_learning_message() to service_role;

create or replace function public.ai_buyer_learning_window_status(p_window_id uuid default null)
returns jsonb
language sql
security definer
set search_path=public
as $$
with target as (
  select *
  from public.ai_buyer_learning_windows
  where (p_window_id is not null and id=p_window_id)
     or (p_window_id is null)
  order by
    case when status='CAPTURING' then 0 else 1 end,
    created_at desc
  limit 1
),
event_stats as (
  select
    e.window_id,
    count(*)::int total_events,
    count(*) filter (where e.direction='INBOUND')::int inbound_events,
    count(*) filter (where e.direction='OUTBOUND')::int outbound_events,
    count(*) filter (where e.speaker='CUSTOMER')::int customer_events,
    count(*) filter (where e.speaker='OWNER_MANUAL')::int owner_manual_events,
    count(distinct e.conversation_id)::int conversations,
    count(*) filter (where e.message_type='IMAGE')::int images,
    min(e.occurred_at) first_event_at,
    max(e.occurred_at) last_event_at
  from public.ai_buyer_learning_events e
  join target t on t.id=e.window_id
  group by e.window_id
),
delivery as (
  select
    s.window_id,
    coalesce(sum(s.chat_messages),0)::int manager_chat_messages_reported,
    count(*)::int delivery_days_collected
  from public.ai_buyer_learning_line_delivery_stats s
  join target t on t.id=s.window_id
  group by s.window_id
),
imports as (
  select
    i.window_id,
    count(*)::int import_files,
    coalesce(sum(i.rows_parsed),0)::int imported_rows,
    count(*) filter (where i.parse_status='RAW_STORED')::int raw_files_waiting_parse
  from public.ai_buyer_learning_imports i
  join target t on t.id=i.window_id
  group by i.window_id
)
select jsonb_build_object(
  'window',to_jsonb(t),
  'events',jsonb_build_object(
    'total',coalesce(e.total_events,0),
    'inbound',coalesce(e.inbound_events,0),
    'outbound',coalesce(e.outbound_events,0),
    'customer',coalesce(e.customer_events,0),
    'ownerManual',coalesce(e.owner_manual_events,0),
    'conversations',coalesce(e.conversations,0),
    'images',coalesce(e.images,0),
    'firstEventAt',e.first_event_at,
    'lastEventAt',e.last_event_at
  ),
  'deliveryAudit',jsonb_build_object(
    'managerChatMessagesReported',coalesce(d.manager_chat_messages_reported,0),
    'daysCollected',coalesce(d.delivery_days_collected,0)
  ),
  'imports',jsonb_build_object(
    'files',coalesce(i.import_files,0),
    'rowsParsed',coalesce(i.imported_rows,0),
    'rawFilesWaitingParse',coalesce(i.raw_files_waiting_parse,0)
  )
)
from target t
left join event_stats e on e.window_id=t.id
left join delivery d on d.window_id=t.id
left join imports i on i.window_id=t.id;
$$;

revoke all on function public.ai_buyer_learning_window_status(uuid) from public,anon,authenticated;
grant execute on function public.ai_buyer_learning_window_status(uuid) to service_role;

-- Create the requested five-day capture window idempotently.
insert into public.ai_buyer_learning_windows(
  name,purpose,starts_at,ends_at,status,source_policy,metadata
)
select
  'LINE Owner Learning 5D 2026-09-22',
  'PRICE_AND_CONVERSATION_STYLE',
  '2026-09-22T18:00:00+07:00'::timestamptz,
  '2026-09-27T18:00:00+07:00'::timestamptz,
  'CAPTURING',
  'LINE_5D_OWNER_MANUAL_V1',
  jsonb_build_object(
    'aiPaused',true,
    'goal','Learn owner buy prices, negotiation pattern, objections, closing style, and generate candidate BookPrice',
    'manualOutboundStrategy','Import LINE OA chat-history CSV after capture; Messaging API webhooks do not expose OA Manager manual outbound message bodies',
    'piiPolicy','Raw archive stays restricted; redact phones/bank/account identifiers before AI analysis'
  )
where not exists (
  select 1 from public.ai_buyer_learning_windows
  where name='LINE Owner Learning 5D 2026-09-22'
);

-- Backfill messages already received since the exact requested start time.
insert into public.ai_buyer_learning_events(
  window_id,source,source_external_id,conversation_id,case_id,
  direction,speaker,message_type,text_content,occurred_at,raw_payload
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
    when m.direction='OUTBOUND' and coalesce(m.metadata->>'source','')='ADMIN_APPROVAL' then 'OWNER_APPROVED'
    when m.direction='OUTBOUND' and coalesce(m.metadata->>'source','') in ('AI','AI_BUYER','AUTOMATION') then 'AI_SYSTEM'
    when m.direction='OUTBOUND' then 'SHOP_OTHER'
    else 'UNKNOWN'
  end,
  m.message_type,
  m.text_content,
  coalesce(m.line_timestamp,m.created_at),
  jsonb_build_object(
    'line_message_id',m.line_message_id,
    'webhook_event_id',m.webhook_event_id,
    'metadata',coalesce(m.metadata,'{}'::jsonb)
  )
from public.ai_buyer_learning_windows w
join public.ai_buyer_messages m
  on coalesce(m.line_timestamp,m.created_at) >= w.starts_at
 and coalesce(m.line_timestamp,m.created_at) < w.ends_at
where w.name='LINE Owner Learning 5D 2026-09-22'
on conflict do nothing;

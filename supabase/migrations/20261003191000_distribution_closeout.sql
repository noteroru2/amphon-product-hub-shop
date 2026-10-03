-- Sales Distribution Closeout
-- Adds coverage matrix, operational alerts, sold-sync guard, stock-turnover strategy,
-- marketplace tracking through existing publication records, and direct/heuristic sale attribution.

create table if not exists public.distribution_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  alert_type text not null check (alert_type in (
    'DISTRIBUTION_GAP','FACEBOOK_QUEUE_STUCK','FACEBOOK_FAILED','FACEBOOK_STALLED',
    'FACEBOOK_PAGE_ERROR','SOLD_ORPHAN_FACEBOOK','SOLD_ORPHAN_MARKETPLACE'
  )),
  severity text not null default 'WARNING' check (severity in ('INFO','WARNING','CRITICAL')),
  product_id uuid references public.products(id) on delete cascade,
  connection_key text,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  details jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists distribution_alerts_open_idx
  on public.distribution_alerts(status,severity,last_seen_at desc);

alter table public.distribution_alerts enable row level security;
drop policy if exists distribution_alerts_admin_read on public.distribution_alerts;
create policy distribution_alerts_admin_read
on public.distribution_alerts for select to authenticated
using (public.current_user_role() in ('owner','admin','sales'));
revoke insert,update,delete on public.distribution_alerts from anon,authenticated;
grant select,insert,update,delete on public.distribution_alerts to service_role;

create table if not exists public.distribution_sale_outcomes (
  id uuid primary key default gen_random_uuid(),
  source_event_id uuid unique,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  sale_channel text not null,
  buyer_type text,
  actual_unit_price numeric(12,2),
  actual_profit numeric(12,2),
  quantity integer not null default 1 check (quantity > 0),
  sold_at timestamptz not null,
  attribution_mode text not null default 'DIRECT' check (attribution_mode in ('DIRECT','LAST_TOUCH')),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists distribution_sale_outcomes_product_sold_idx
  on public.distribution_sale_outcomes(product_id,sold_at desc);
create index if not exists distribution_sale_outcomes_channel_sold_idx
  on public.distribution_sale_outcomes(sale_channel,sold_at desc);

alter table public.distribution_sale_outcomes enable row level security;
drop policy if exists distribution_sale_outcomes_admin_read on public.distribution_sale_outcomes;
create policy distribution_sale_outcomes_admin_read
on public.distribution_sale_outcomes for select to authenticated
using (public.current_user_role() in ('owner','admin','sales'));
revoke insert,update,delete on public.distribution_sale_outcomes from anon,authenticated;
grant select,insert,update,delete on public.distribution_sale_outcomes to service_role;

create or replace view public.distribution_strategy_v
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.title,
  p.status,
  p.one_availability,
  coalesce(p.one_stock_age_days,0) as stock_age_days,
  p.one_aging_bucket as aging_bucket,
  p.one_dealer_eligibility as dealer_eligibility,
  p.one_price_strategy as price_strategy,
  case
    when p.one_availability is distinct from 'IN_STOCK' then 'STOP'
    when coalesce(p.one_stock_age_days,0) > 60
      or p.one_dealer_eligibility = 'CLEARANCE' then 'CLEARANCE'
    when coalesce(p.one_stock_age_days,0) > 45 then 'PUSH_DEALER'
    when coalesce(p.one_stock_age_days,0) > 30 then 'QUICK_SALE'
    else 'HOLD_RETAIL'
  end as distribution_strategy,
  case
    when p.one_availability is distinct from 'IN_STOCK' then 0
    when coalesce(p.one_stock_age_days,0) > 30 then 3
    else 2
  end as facebook_posts_per_week,
  case
    when p.one_availability is distinct from 'IN_STOCK' then false
    when coalesce(p.one_stock_age_days,0) > 30 then true
    else false
  end as marketplace_required
from public.products p
where p.one_managed = true;

grant select on public.distribution_strategy_v to authenticated,service_role;

create or replace view public.distribution_coverage_v
with (security_invoker = true)
as
with active_pages as (
  select count(*)::int as n
  from public.sales_channel_connections
  where channel_key='facebook_page'
    and activation_status='ACTIVE'
    and environment='PRODUCTION'
),
fb as (
  select product_id,
         count(*) filter (where status='LIVE')::int as live_count,
         max(updated_at) filter (where status='LIVE') as last_live_at
  from public.facebook_post_ledger
  group by product_id
),
pub as (
  select product_id,
    bool_or(channel='website' and status='published') as website_published,
    bool_or(channel='marketplace' and status='published') as marketplace_posted,
    bool_or(channel='marketplace' and status='published' and external_url is not null) as marketplace_verified,
    max(published_at) filter (where channel='marketplace' and status='published') as marketplace_published_at,
    max(external_url) filter (where channel='marketplace' and status='published') as marketplace_url,
    bool_or(channel='line' and status='published') as line_shared
  from public.product_publications
  group by product_id
)
select
  s.product_id,
  s.sku,
  s.title,
  s.status,
  s.one_availability,
  s.stock_age_days,
  s.aging_bucket,
  s.dealer_eligibility,
  s.distribution_strategy,
  s.facebook_posts_per_week,
  s.marketplace_required,
  coalesce(pub.website_published,false) as website_published,
  coalesce(fb.live_count,0) as facebook_live_pages,
  ap.n as facebook_required_pages,
  coalesce(pub.marketplace_posted,false) as marketplace_posted,
  coalesce(pub.marketplace_verified,false) as marketplace_published,
  pub.marketplace_published_at,
  pub.marketplace_url,
  coalesce(pub.line_shared,false) as line_shared,
  (1 + ap.n + case when s.marketplace_required then 1 else 0 end)::int as required_channel_points,
  (
    case when coalesce(pub.website_published,false) then 1 else 0 end
    + least(coalesce(fb.live_count,0),ap.n)
    + case when s.marketplace_required and coalesce(pub.marketplace_verified,false) then 1 else 0 end
  )::int as covered_channel_points,
  round(
    100.0 * (
      case when coalesce(pub.website_published,false) then 1 else 0 end
      + least(coalesce(fb.live_count,0),ap.n)
      + case when s.marketplace_required and coalesce(pub.marketplace_verified,false) then 1 else 0 end
    ) / nullif((1 + ap.n + case when s.marketplace_required then 1 else 0 end),0)
  ,1) as coverage_pct,
  f.last_live_at
from public.distribution_strategy_v s
cross join active_pages ap
left join fb on fb.product_id=s.product_id
left join pub on pub.product_id=s.product_id
where s.one_availability='IN_STOCK'
  and s.status in ('ready_to_list','published','reserved');

grant select on public.distribution_coverage_v to authenticated,service_role;

create or replace view public.facebook_content_sale_performance_v
with (security_invoker = true)
as
with direct_sales as (
  select
    so.id sale_id, so.product_id, so.sold_at, so.actual_profit,
    l.connection_key, l.template_id, l.posted_at,
    row_number() over (
      partition by so.id
      order by l.posted_at desc
    ) as rn
  from public.distribution_sale_outcomes so
  join public.facebook_learning_ledger l
    on l.product_id=so.product_id
   and l.posted_at<=so.sold_at
   and l.posted_at>=so.sold_at-interval '14 days'
  where upper(so.sale_channel) in ('FACEBOOK','FB','FACEBOOK_PAGE')
    and so.attribution_mode='DIRECT'
),
agg_sales as (
  select connection_key,template_id,
         count(*)::int as direct_sales,
         coalesce(sum(actual_profit),0)::numeric(14,2) as direct_profit
  from direct_sales where rn=1
  group by connection_key,template_id
),
post_metrics as (
  select connection_key,template_id,
         count(*)::int as posts,
         count(*) filter(where metric_status='COLLECTED')::int as measured_posts,
         avg(reach) filter(where metric_status='COLLECTED')::numeric(14,2) as avg_reach,
         avg(impressions) filter(where metric_status='COLLECTED')::numeric(14,2) as avg_impressions,
         avg(coalesce(engaged_users,0)) filter(where metric_status='COLLECTED')::numeric(14,2) as avg_engaged
  from public.facebook_learning_ledger
  group by connection_key,template_id
)
select
  p.connection_key,p.template_id,p.posts,p.measured_posts,
  p.avg_reach,p.avg_impressions,p.avg_engaged,
  coalesce(s.direct_sales,0) as direct_sales,
  coalesce(s.direct_profit,0) as direct_profit,
  case when p.posts>0 then round(100.0*coalesce(s.direct_sales,0)/p.posts,2) else 0 end as direct_sales_per_100_posts
from post_metrics p
left join agg_sales s using(connection_key,template_id);

grant select on public.facebook_content_sale_performance_v to authenticated,service_role;

create or replace function public.distribution_refresh_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  touched text[] := '{}';
  opened integer := 0;
  resolved integer := 0;
begin
  -- Distribution gaps.
  insert into public.distribution_alerts(alert_key,alert_type,severity,product_id,details,last_seen_at,resolved_at,status)
  select
    'GAP:'||c.product_id::text,
    'DISTRIBUTION_GAP',
    case when c.coverage_pct<50 then 'CRITICAL' else 'WARNING' end,
    c.product_id,
    jsonb_build_object(
      'sku',c.sku,'coveragePct',c.coverage_pct,'strategy',c.distribution_strategy,
      'website',c.website_published,'facebookLivePages',c.facebook_live_pages,
      'facebookRequiredPages',c.facebook_required_pages,'marketplace',c.marketplace_published,
      'marketplaceRequired',c.marketplace_required
    ),
    now(),null,'OPEN'
  from public.distribution_coverage_v c
  where c.coverage_pct<100
  on conflict(alert_key) do update set
    severity=excluded.severity,details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  select coalesce(array_agg('GAP:'||product_id::text),'{}') into touched
  from public.distribution_coverage_v where coverage_pct<100;

  update public.distribution_alerts
    set status='RESOLVED',resolved_at=now(),last_seen_at=now()
  where alert_type='DISTRIBUTION_GAP' and status='OPEN'
    and not (alert_key=any(touched));
  get diagnostics resolved=row_count;

  -- Facebook due/stuck jobs.
  insert into public.distribution_alerts(alert_key,alert_type,severity,product_id,connection_key,details,last_seen_at,resolved_at,status)
  select
    'FBSTUCK:'||q.id::text,'FACEBOOK_QUEUE_STUCK','WARNING',q.product_id,q.connection_key,
    jsonb_build_object('queueId',q.id,'scheduledAt',q.scheduled_at,'status',q.status,'attempts',q.attempts,'error',q.last_error),
    now(),null,'OPEN'
  from public.facebook_rotation_queue q
  where q.status in ('PLANNED','CLAIMED','FAILED')
    and q.scheduled_at<now()-interval '30 minutes'
  on conflict(alert_key) do update set details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='FACEBOOK_QUEUE_STUCK' and a.status='OPEN'
     and not exists (
       select 1 from public.facebook_rotation_queue q
       where a.alert_key='FBSTUCK:'||q.id::text
         and q.status in ('PLANNED','CLAIMED','FAILED')
         and q.scheduled_at<now()-interval '30 minutes'
     );

  -- Facebook terminal/repeated failures.
  insert into public.distribution_alerts(alert_key,alert_type,severity,product_id,connection_key,details,last_seen_at,resolved_at,status)
  select
    'FBFAIL:'||q.id::text,'FACEBOOK_FAILED',
    case when q.attempts>=3 then 'CRITICAL' else 'WARNING' end,
    q.product_id,q.connection_key,
    jsonb_build_object('queueId',q.id,'attempts',q.attempts,'error',q.last_error,'nextAttemptAt',q.next_attempt_at),
    now(),null,'OPEN'
  from public.facebook_rotation_queue q
  where q.status='FAILED'
  on conflict(alert_key) do update set severity=excluded.severity,details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='FACEBOOK_FAILED' and a.status='OPEN'
     and not exists (
       select 1 from public.facebook_rotation_queue q
       where a.alert_key='FBFAIL:'||q.id::text and q.status='FAILED'
     );

  -- Facebook scheduler stalled: sellable products exist but no successful post for >6h.
  insert into public.distribution_alerts(alert_key,alert_type,severity,details,last_seen_at,resolved_at,status)
  select
    'FBSTALLED','FACEBOOK_STALLED','CRITICAL',
    jsonb_build_object(
      'lastPostedAt',(select max(posted_at) from public.facebook_rotation_queue where status='POSTED'),
      'eligibleProducts',(select count(*) from public.products where one_availability='IN_STOCK' and status in('ready_to_list','published','reserved')),
      'plannedJobs',(select count(*) from public.facebook_rotation_queue where status in('PLANNED','CLAIMED','FAILED'))
    ),
    now(),null,'OPEN'
  where exists(
      select 1 from public.products
      where one_availability='IN_STOCK' and status in('ready_to_list','published','reserved')
    )
    and coalesce(
      (select max(posted_at) from public.facebook_rotation_queue where status='POSTED'),
      timestamp with time zone '1970-01-01 00:00:00+00'
    ) < now()-interval '6 hours'
  on conflict(alert_key) do update set
    severity=excluded.severity,details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where alert_key='FBSTALLED' and status='OPEN'
     and (
       not exists(
         select 1 from public.products
         where one_availability='IN_STOCK' and status in('ready_to_list','published','reserved')
       )
       or coalesce(
         (select max(posted_at) from public.facebook_rotation_queue where status='POSTED'),
         now()
       ) >= now()-interval '6 hours'
     );

  -- Facebook connection health.
  insert into public.distribution_alerts(alert_key,alert_type,severity,connection_key,details,last_seen_at,resolved_at,status)
  select
    'FBPAGE:'||c.connection_key,'FACEBOOK_PAGE_ERROR','CRITICAL',c.connection_key,
    jsonb_build_object('status',c.status,'activationStatus',c.activation_status,'environment',c.environment,'lastError',c.last_error),
    now(),null,'OPEN'
  from public.sales_channel_connections c
  where c.channel_key='facebook_page'
    and c.environment='PRODUCTION'
    and (
      c.activation_status is distinct from 'ACTIVE'
      or c.status in ('EXPIRED','REVOKED','ERROR')
      or c.last_error is not null
    )
  on conflict(alert_key) do update set details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='FACEBOOK_PAGE_ERROR' and a.status='OPEN'
     and not exists (
       select 1 from public.sales_channel_connections c
       where c.channel_key='facebook_page' and c.connection_key=a.connection_key
         and c.environment='PRODUCTION'
         and (c.activation_status is distinct from 'ACTIVE'
              or c.status in ('EXPIRED','REVOKED','ERROR')
              or c.last_error is not null)
     );

  -- Sold orphans on Facebook.
  insert into public.distribution_alerts(alert_key,alert_type,severity,product_id,connection_key,details,last_seen_at,resolved_at,status)
  select
    'SOLDFB:'||l.id::text,'SOLD_ORPHAN_FACEBOOK','CRITICAL',l.product_id,l.connection_key,
    jsonb_build_object('postId',l.post_id,'externalUrl',l.external_url,'sku',p.sku),
    now(),null,'OPEN'
  from public.facebook_post_ledger l
  join public.products p on p.id=l.product_id
  where l.status='LIVE'
    and (p.one_availability='SOLD' or p.status='sold')
  on conflict(alert_key) do update set details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='SOLD_ORPHAN_FACEBOOK' and a.status='OPEN'
     and not exists (
       select 1 from public.facebook_post_ledger l
       join public.products p on p.id=l.product_id
       where a.alert_key='SOLDFB:'||l.id::text
         and l.status='LIVE'
         and (p.one_availability='SOLD' or p.status='sold')
     );

  -- Marketplace requires human confirmation that external listing was removed.
  insert into public.distribution_alerts(alert_key,alert_type,severity,product_id,details,last_seen_at,resolved_at,status)
  select
    'SOLDMP:'||pp.id::text,'SOLD_ORPHAN_MARKETPLACE','CRITICAL',pp.product_id,
    jsonb_build_object('publicationId',pp.id,'externalUrl',pp.external_url,'listingRef',pp.listing_ref,'sku',p.sku),
    now(),null,'OPEN'
  from public.product_publications pp
  join public.products p on p.id=pp.product_id
  where pp.channel='marketplace' and pp.status='published'
    and (p.one_availability='SOLD' or p.status='sold')
  on conflict(alert_key) do update set details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='SOLD_ORPHAN_MARKETPLACE' and a.status='OPEN'
     and not exists (
       select 1 from public.product_publications pp
       join public.products p on p.id=pp.product_id
       where a.alert_key='SOLDMP:'||pp.id::text
         and pp.channel='marketplace' and pp.status='published'
         and (p.one_availability='SOLD' or p.status='sold')
     );

  select count(*) into opened from public.distribution_alerts where status='OPEN';
  return jsonb_build_object('open',opened,'resolvedThisRun',resolved,'refreshedAt',now());
end;
$$;

revoke all on function public.distribution_refresh_alerts() from public,anon,authenticated;
grant execute on function public.distribution_refresh_alerts() to service_role;

-- Dynamic Facebook distribution intensity from Stock Turnover.
create or replace function public.facebook_rotation_generate_week(target_date date default ((now() at time zone 'Asia/Bangkok')::date))
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  wk text; monday date; inserted_count int:=0; p record; product_no int:=0;
  rot int; rotations int; day_offset int; slot int; local_ts timestamp;
  page_key text; pages text[]; daily_budget int; pick record;
begin
  monday:=target_date-(extract(isodow from target_date)::int-1);
  wk:=to_char(monday,'IYYY-IW');
  if exists(select 1 from public.facebook_rotation_queue where week_key=wk) then return 0; end if;

  select active_connection_keys,least(coalesce(page_daily_budget,12),12)
    into pages,daily_budget from public.facebook_rotation_settings where id=true;
  if coalesce(array_length(pages,1),0)=0 then return 0; end if;

  for p in
    select id,coalesce(one_stock_age_days,0) age_days
    from public.products
    where status in('ready_to_list','published','reserved')
      and one_availability='IN_STOCK'
    order by id
  loop
    rotations:=case when p.age_days>30 then 3 else 2 end;
    for rot in 1..rotations loop
      page_key:=pages[((product_no+rot-1)%array_length(pages,1))+1];
      day_offset:=(product_no+case when rot=1 then 0 when rot=2 then 3 else 5 end)%7;
      slot:=((product_no/7)::int+case when rot=1 then 0 when rot=2 then 6 else 9 end)%daily_budget;
      local_ts:=monday::timestamp+day_offset*interval '1 day'
        +case when slot<5 then time '11:30'+slot*interval '25 minutes'
              else time '18:30'+(slot-5)*interval '25 minutes' end;

      select * into pick
      from public.facebook_learning_pick(
        page_key,
        extract(dow from local_ts)::smallint,
        extract(hour from local_ts)::smallint,
        'ROT-'||(((product_no+rot-1)%8)+1)
      );
      if pick.reason='LEARNED' then
        local_ts=date_trunc('day',local_ts)+make_interval(hours=>pick.hour);
      end if;

      if (select count(*) from public.facebook_rotation_queue q
          where q.connection_key=page_key
            and (q.scheduled_at at time zone 'Asia/Bangkok')::date=local_ts::date
            and q.status in('PLANNED','CLAIMED','POSTED'))<daily_budget
         and not exists(
           select 1 from public.facebook_rotation_queue q
           where q.product_id=p.id and q.status in('PLANNED','CLAIMED','POSTED')
             and abs(extract(epoch from(q.scheduled_at-(local_ts at time zone 'Asia/Bangkok'))))<172800
         )
      then
        insert into public.facebook_rotation_queue(product_id,connection_key,scheduled_at,week_key,rotation_no,template_id,status)
        values(p.id,page_key,local_ts at time zone 'Asia/Bangkok',wk,rot,pick.template_id,'PLANNED')
        on conflict do nothing;
        if found then inserted_count:=inserted_count+1; end if;
      end if;
    end loop;
    product_no:=product_no+1;
  end loop;

  update public.facebook_rotation_settings
  set last_generated_week=wk,last_generated_at=now()
  where id=true;
  return inserted_count;
end;
$$;

revoke all on function public.facebook_rotation_generate_week(date) from public,anon,authenticated;
grant execute on function public.facebook_rotation_generate_week(date) to service_role;

create or replace function public.distribution_consume_sale_event(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_inbox public.integration_event_inbox%rowtype;
  v_payload jsonb;
  v_link public.external_entity_links%rowtype;
  v_product_id uuid;
  v_identity_id text;
  v_sku text;
  v_error text;
begin
  select * into v_inbox
  from public.integration_event_inbox
  where event_id=p_event_id
  for update;

  if not found then return jsonb_build_object('outcome','NOT_FOUND','error','SALE_INBOX_EVENT_NOT_FOUND'); end if;
  if v_inbox.status='PROCESSED' then return jsonb_build_object('outcome','DUPLICATE','sku',v_inbox.entity_sku); end if;
  if v_inbox.status='DEAD' then return jsonb_build_object('outcome','DEAD','error',coalesce(v_inbox.last_error,'SALE_EVENT_DEAD')); end if;

  v_payload:=v_inbox.payload->'payload';
  v_identity_id:=nullif(btrim(coalesce(v_payload->>'productIdentityId','')),'');
  v_sku:=upper(nullif(btrim(coalesce(v_payload->>'sku','')),''));

  if v_inbox.source<>'amphon-system'
     or v_inbox.event_type<>'product.sale_completed'
     or v_inbox.entity_type<>'product_intake_unit'
     or v_identity_id is null or v_sku is null
     or v_identity_id<>coalesce(v_inbox.entity_id,'')
     or v_sku<>upper(coalesce(v_inbox.entity_sku,''))
  then
    v_error:='SALE_EVENT_INVALID';
    update public.integration_event_inbox set status='DEAD',last_error=v_error,updated_at=now() where id=v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error);
  end if;

  select * into v_link
  from public.external_entity_links
  where source_system='amphon-system'
    and source_entity_type='product_intake_unit'
    and source_entity_id=v_identity_id
    and target_system='product-hub'
    and target_entity_type='product'
  limit 1;

  if not found then
    v_error:='SALE_MAPPING_NOT_FOUND';
    update public.integration_event_inbox set status='FAILED',last_error=v_error,updated_at=now() where id=v_inbox.id;
    return jsonb_build_object('outcome','RETRY','error',v_error,'sku',v_sku);
  end if;

  begin v_product_id:=v_link.target_entity_id::uuid;
  exception when others then v_product_id:=null;
  end;

  if v_product_id is null or not exists(
    select 1 from public.products where id=v_product_id and upper(sku)=v_sku
  ) then
    v_error:='SALE_MAPPING_CONFLICT';
    update public.integration_event_inbox set status='DEAD',last_error=v_error,updated_at=now() where id=v_inbox.id;
    return jsonb_build_object('outcome','CONFLICT','error',v_error,'sku',v_sku);
  end if;

  insert into public.distribution_sale_outcomes(
    source_event_id,product_id,sku,sale_channel,buyer_type,actual_unit_price,actual_profit,quantity,sold_at,attribution_mode,source_payload
  ) values(
    p_event_id,v_product_id,v_sku,
    upper(coalesce(nullif(v_payload->>'saleChannel',''),'UNKNOWN')),
    upper(nullif(v_payload->>'buyerType','')),
    nullif(v_payload->>'actualUnitPrice','')::numeric,
    nullif(v_payload->>'actualProfit','')::numeric,
    greatest(1,coalesce(nullif(v_payload->>'quantity','')::integer,1)),
    coalesce(nullif(v_payload->>'soldAt','')::timestamptz,now()),
    'DIRECT',v_payload
  )
  on conflict(source_event_id) do nothing;

  update public.integration_event_inbox
  set status='PROCESSED',processed_at=coalesce(processed_at,now()),last_error=null,updated_at=now()
  where id=v_inbox.id;

  return jsonb_build_object('outcome','APPLIED','hubProductId',v_product_id::text,'sku',v_sku);
end;
$$;

revoke all on function public.distribution_consume_sale_event(uuid) from public,anon,authenticated;
grant execute on function public.distribution_consume_sale_event(uuid) to service_role;

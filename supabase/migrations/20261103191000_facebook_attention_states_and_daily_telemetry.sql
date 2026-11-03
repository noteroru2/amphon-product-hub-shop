
-- Visible to the service-role backend only, not directly to public clients.
CREATE OR REPLACE VIEW public.facebook_automation_queue_status_v
WITH (security_invoker=true) AS
SELECT
 q.id,q.connection_key,q.lane,q.template_id,q.status,q.product_id,
 q.scheduled_at,q.claimed_at,q.posted_at,q.post_id,q.attempts,q.last_error,
 p.sku,p.title,p.category,coalesce(p.one_stock_age_days,0) AS stock_age_days,
 COALESCE(g.gate->>'reason','READY') AS gate_reason,
 CASE
  WHEN q.status='FAILED' AND
    (a.state IN ('PREPARED','NEEDS_REVIEW') OR q.last_error LIKE '%UNRECONCILED%'
      OR q.last_error LIKE '%UNCERTAIN%') THEN 'NEEDS_REVIEW'
  WHEN q.status='FAILED' AND q.post_id IS NOT NULL THEN 'REPAIR_PENDING'
  WHEN q.status='FAILED' THEN 'FAILED'
  WHEN q.status='CLAIMED' AND q.claimed_at<now()-interval '10 minutes' THEN 'NEEDS_REVIEW'
  WHEN q.status='CLAIMED' THEN 'POSTING'
  WHEN q.status='PLANNED' AND q.post_id IS NOT NULL THEN 'REPAIR_PENDING'
  WHEN w.retry_at>now() AND w.last_error IS NOT NULL
    AND w.last_error ~* '(368|80001|613|temporarily blocked|rate.limit|สแปม|จำกัดจำนวน)' THEN 'META_COOLDOWN'
  WHEN g.gate->>'reason'='META_USAGE_SAFETY_HOLD' THEN 'META_COOLDOWN'
  WHEN g.gate->>'reason'='ROLLING_24H_POST_LIMIT' THEN 'WAITING_BUDGET'
  WHEN g.gate->>'reason' IN ('MIN_PUBLISH_GAP','PAGE_COOLDOWN','OUTSIDE_PUBLISHING_HOURS')
      OR q.scheduled_at>now() THEN 'WAITING_GAP'
  WHEN g.gate->>'reason' IN ('PUBLISH_DISABLED','PAGE_NOT_ACTIVE') THEN 'PAUSED'
  ELSE 'READY'
 END::text AS attention_state,
 CASE WHEN g.gate->>'retry_at' IS NOT NULL
   THEN (g.gate->>'retry_at')::timestamptz
   ELSE q.scheduled_at END AS next_eligible_at
FROM public.facebook_rotation_queue q
JOIN public.products p ON p.id=q.product_id
LEFT JOIN public.facebook_publish_attempts a ON a.queue_id=q.id
LEFT JOIN public.facebook_page_write_state w ON w.connection_key=q.connection_key
CROSS JOIN LATERAL (
 SELECT public.facebook_page_publish_gate(q.connection_key) AS gate
) g
WHERE q.status IN ('PLANNED','CLAIMED','FAILED');
REVOKE ALL ON public.facebook_automation_queue_status_v FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.facebook_automation_queue_status_v TO service_role;

CREATE OR REPLACE VIEW public.facebook_automation_daily_v
WITH (security_invoker=true) AS
SELECT (q.posted_at AT TIME ZONE 'Asia/Bangkok')::date AS day_bkk,
 q.connection_key,
 count(DISTINCT q.post_id) AS posted_count,
 count(DISTINCT q.post_id) FILTER(WHERE q.lane='NEW_ARRIVAL') AS new_arrival_count,
 count(DISTINCT q.post_id) FILTER(WHERE q.lane='ROTATION') AS rotation_count
FROM public.facebook_rotation_queue q
WHERE q.status='POSTED' AND q.post_id IS NOT NULL
  AND q.posted_at>now()-interval '31 days'
GROUP BY 1,2;
REVOKE ALL ON public.facebook_automation_daily_v FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.facebook_automation_daily_v TO service_role;

-- Resolve false-positive queue alerts rather than treating intentional page waits as failures.
CREATE OR REPLACE FUNCTION public.distribution_refresh_alerts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where q.status='CLAIMED'
    and q.claimed_at<now()-interval '30 minutes'
  on conflict(alert_key) do update set details=excluded.details,last_seen_at=now(),resolved_at=null,status='OPEN';

  update public.distribution_alerts a
     set status='RESOLVED',resolved_at=now(),last_seen_at=now()
   where a.alert_type='FACEBOOK_QUEUE_STUCK' and a.status='OPEN'
     and not exists (
       select 1 from public.facebook_rotation_queue q
       where a.alert_key='FBSTUCK:'||q.id::text
         and q.status='CLAIMED'
         and q.claimed_at<now()-interval '30 minutes'
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
    -- Waiting for planned quotas, spacing or off-hours is not an outage.
    and exists (
      select 1 from public.sales_channel_connections c
      where c.channel_key='facebook_page'
        and c.activation_status='ACTIVE' and c.environment='PRODUCTION'
        and coalesce((public.facebook_page_publish_gate(c.connection_key)->>'allowed')::boolean,false)
    )
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
       or not exists(
         select 1 from public.sales_channel_connections c
         where c.channel_key='facebook_page'
           and c.activation_status='ACTIVE' and c.environment='PRODUCTION'
           and coalesce((public.facebook_page_publish_gate(c.connection_key)->>'allowed')::boolean,false)
       )
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
END;
$function$;

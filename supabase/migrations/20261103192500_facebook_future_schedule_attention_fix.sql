-- Distinguish future scheduled jobs from currently due jobs waiting for quota.
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
  -- A task scheduled for the future is a normal wait, even if Page budget
  -- happens to be exhausted at the current time.
  WHEN q.status='PLANNED' AND q.scheduled_at>now() THEN 'WAITING_GAP'
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


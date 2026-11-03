-- No Graph /feed call may start without a durable prepare receipt. This makes
-- ambiguous outcomes non-retryable, even if the Worker is terminated mid-call.
CREATE TABLE IF NOT EXISTS public.facebook_publish_attempts (
  queue_id uuid PRIMARY KEY REFERENCES public.facebook_rotation_queue(id) ON DELETE CASCADE,
  connection_key text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  marker text UNIQUE,
  state text NOT NULL CHECK (state IN ('PREPARED','CONFIRMED','REJECTED','NEEDS_REVIEW')),
  post_id text UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  reconcile_attempts integer NOT NULL DEFAULT 0,
  next_reconcile_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_publish_attempts_reconcile_idx
 ON public.facebook_publish_attempts(state,next_reconcile_at,started_at);
ALTER TABLE public.facebook_publish_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_publish_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.facebook_publish_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.facebook_publish_prepare(p_queue_id uuid,p_connection_key text,p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $prepare$
DECLARE q public.facebook_rotation_queue%rowtype; a public.facebook_publish_attempts%rowtype;
BEGIN
 SELECT * INTO q FROM public.facebook_rotation_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.connection_key<>p_connection_key OR q.status<>'CLAIMED'
    OR q.post_id IS NOT NULL OR q.claim_token IS DISTINCT FROM p_claim_token
    OR p_claim_token IS NULL THEN
  RETURN jsonb_build_object('ready',false,'reason','QUEUE_CLAIM_CHANGED');
 END IF;
 INSERT INTO public.facebook_publish_attempts(queue_id,connection_key,product_id,marker,state,started_at)
 VALUES(q.id,q.connection_key,q.product_id,'AMPHON-'||replace(q.id::text,'-',''),'PREPARED',now())
 ON CONFLICT(queue_id) DO NOTHING
 RETURNING * INTO a;
 IF FOUND THEN RETURN jsonb_build_object('ready',true,'marker',a.marker); END IF;
 SELECT * INTO a FROM public.facebook_publish_attempts WHERE queue_id=q.id FOR UPDATE;
 IF a.state='REJECTED' THEN
  UPDATE public.facebook_publish_attempts SET state='PREPARED',started_at=now(),
     last_error=NULL,next_reconcile_at=NULL,reconcile_attempts=0,updated_at=now()
  WHERE queue_id=q.id RETURNING * INTO a;
  RETURN jsonb_build_object('ready',true,'marker',a.marker);
 END IF;
 -- A PREPARED attempt might already have posted on Meta. Do not repeat /feed.
 RETURN jsonb_build_object('ready',false,'reason','PUBLISH_ATTEMPT_ALREADY_EXISTS',
    'state',a.state,'post_id',a.post_id);
END;
$prepare$;

CREATE OR REPLACE FUNCTION public.facebook_publish_capture(
 p_queue_id uuid,p_connection_key text,p_post_id text,p_marker text DEFAULT NULL,
 p_verified_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $capture$
DECLARE q public.facebook_rotation_queue%rowtype; a public.facebook_publish_attempts%rowtype;
        v_time timestamptz;
BEGIN
 IF p_post_id IS NULL OR length(trim(p_post_id))<3 OR length(p_post_id)>160 THEN
  RAISE EXCEPTION 'FACEBOOK_POST_ID_INVALID';
 END IF;
 SELECT * INTO q FROM public.facebook_rotation_queue WHERE id=p_queue_id FOR UPDATE;
 IF NOT FOUND OR q.connection_key<>p_connection_key OR
    (q.post_id IS NOT NULL AND q.post_id<>p_post_id) THEN
  RAISE EXCEPTION 'FACEBOOK_QUEUE_IDENTITY_CONFLICT';
 END IF;
 SELECT * INTO a FROM public.facebook_publish_attempts WHERE queue_id=p_queue_id FOR UPDATE;
 IF NOT FOUND THEN
  -- Legacy untagged posts: permit recovery only after external post validation.
  IF q.last_error NOT LIKE '%UNRECONCILED%' OR p_verified_at IS NULL
     OR q.claimed_at IS NULL OR
     abs(extract(epoch from(p_verified_at-q.claimed_at)))>600 THEN
    RAISE EXCEPTION 'FACEBOOK_UNTRACKED_POST_RECONCILIATION_REFUSED';
  END IF;
  INSERT INTO public.facebook_publish_attempts(
    queue_id,connection_key,product_id,marker,state,post_id,started_at,confirmed_at)
  VALUES(q.id,q.connection_key,q.product_id,NULL,'CONFIRMED',p_post_id,q.claimed_at,now())
  RETURNING * INTO a;
 ELSE
  IF a.connection_key<>p_connection_key OR a.product_id<>q.product_id OR
     a.marker IS DISTINCT FROM p_marker OR
     (a.post_id IS NOT NULL AND a.post_id<>p_post_id) THEN
    RAISE EXCEPTION 'FACEBOOK_PUBLISH_ATTEMPT_IDENTITY_CONFLICT';
  END IF;
  UPDATE public.facebook_publish_attempts
  SET state='CONFIRMED',post_id=p_post_id,confirmed_at=coalesce(confirmed_at,now()),
      last_error=NULL,next_reconcile_at=NULL,updated_at=now()
  WHERE queue_id=p_queue_id;
 END IF;
 v_time:=coalesce(p_verified_at,now());
 UPDATE public.facebook_rotation_queue
 SET post_id=p_post_id,posted_at=coalesce(posted_at,v_time),last_error=NULL,
     next_attempt_at=NULL
 WHERE id=p_queue_id AND (post_id IS NULL OR post_id=p_post_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'FACEBOOK_QUEUE_POST_ID_WRITE_FAILED'; END IF;
 INSERT INTO public.facebook_post_ledger(product_id,connection_key,page_id,post_id,status,external_url,published_at,updated_at)
 VALUES(q.product_id,q.connection_key,split_part(p_post_id,'_',1),p_post_id,'ERROR',
        'https://www.facebook.com/'||p_post_id,v_time,now())
 ON CONFLICT(post_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'post_id',p_post_id);
END;
$capture$;

CREATE OR REPLACE FUNCTION public.facebook_publish_reject(p_queue_id uuid,p_connection_key text,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $reject$
BEGIN
 UPDATE public.facebook_publish_attempts SET state='REJECTED',last_error=left(p_error,400),
   updated_at=now() WHERE queue_id=p_queue_id AND connection_key=p_connection_key
   AND state='PREPARED' AND post_id IS NULL;
END;
$reject$;

CREATE OR REPLACE FUNCTION public.facebook_publish_reconcile_claim(max_jobs integer DEFAULT 3)
RETURNS TABLE(queue_id uuid,connection_key text,marker text,started_at timestamptz,sku text,attempt_no integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $reconcile$
BEGIN
 RETURN QUERY
 WITH selected AS (
  SELECT a.queue_id
  FROM public.facebook_publish_attempts a
  JOIN public.facebook_rotation_queue q ON q.id=a.queue_id
  WHERE a.state IN ('PREPARED','NEEDS_REVIEW') AND a.post_id IS NULL
    AND q.post_id IS NULL AND a.started_at<now()-interval '2 minutes'
    AND coalesce(a.next_reconcile_at,a.started_at)<=now()
    AND a.reconcile_attempts<2
  ORDER BY a.started_at
  LIMIT greatest(1,least(max_jobs,4))
  FOR UPDATE OF a SKIP LOCKED
 ), updated AS (
  UPDATE public.facebook_publish_attempts a SET reconcile_attempts=a.reconcile_attempts+1,
    next_reconcile_at=now()+interval '1 hour',updated_at=now()
  FROM selected s WHERE a.queue_id=s.queue_id
  RETURNING a.queue_id,a.connection_key,a.marker,a.started_at,a.reconcile_attempts
 )
 SELECT u.queue_id,u.connection_key,u.marker,u.started_at,p.sku,u.reconcile_attempts
 FROM updated u JOIN public.facebook_rotation_queue q ON q.id=u.queue_id
 JOIN public.products p ON p.id=q.product_id;
END;
$reconcile$;

CREATE OR REPLACE FUNCTION public.facebook_publish_reconcile_result(
 p_queue_id uuid,p_error text,p_permission_denied boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $res$
BEGIN
 UPDATE public.facebook_publish_attempts SET
    state=CASE WHEN p_permission_denied OR reconcile_attempts>=2 THEN 'NEEDS_REVIEW' ELSE state END,
    reconcile_attempts=CASE WHEN p_permission_denied THEN greatest(reconcile_attempts,2) ELSE reconcile_attempts END,
    last_error=left(p_error,400),
    next_reconcile_at=CASE WHEN p_permission_denied OR reconcile_attempts>=2 THEN NULL ELSE now()+interval '1 hour' END,
    updated_at=now()
 WHERE queue_id=p_queue_id AND post_id IS NULL;
END;
$res$;

-- Refuse an automatic /feed retry if there is a durable prepared attempt.
-- Confirmed post IDs can still be picked up for ledger/verification repair.
-- A claim may hold a page lease but must never rely only on transient memory.
CREATE OR REPLACE FUNCTION public.facebook_rotation_preflight_is_safe(p_queue_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $safe$
 SELECT NOT EXISTS (
   SELECT 1 FROM public.facebook_publish_attempts a
   WHERE a.queue_id=p_queue_id AND a.post_id IS NULL
     AND a.state IN('PREPARED','NEEDS_REVIEW','CONFIRMED')
 );
$safe$;
DO $revoke$
DECLARE r record;
BEGIN
 FOR r IN SELECT proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN
 ('facebook_publish_prepare','facebook_publish_capture','facebook_publish_reject',
 'facebook_publish_reconcile_claim','facebook_publish_reconcile_result','facebook_rotation_preflight_is_safe')
 LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated',r.proname,r.args);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',r.proname,r.args);
 END LOOP;
END;
$revoke$;

-- Apply safety check on all publisher claim paths and reserve ambiguous slots.
CREATE OR REPLACE FUNCTION public.facebook_rotation_claim_due(max_jobs integer DEFAULT 3)
 RETURNS SETOF facebook_rotation_queue
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  s public.facebook_rotation_settings%rowtype;
  j public.facebook_rotation_queue%rowtype;
  picked integer := 0;
  local_today date;
BEGIN
  SELECT * INTO s FROM public.facebook_rotation_settings WHERE id=true FOR UPDATE;
  PERFORM public.facebook_rotation_expire_stale(48);
  PERFORM public.facebook_rotation_quarantine_unreconciled();
  IF NOT s.enabled OR s.dry_run THEN RETURN; END IF;
  local_today := (now() AT TIME ZONE s.timezone)::date;

  FOR j IN
    SELECT q.* FROM public.facebook_rotation_queue q
    JOIN public.products p ON p.id=q.product_id
    WHERE q.status IN ('PLANNED','FAILED') AND q.scheduled_at<=now()
      AND coalesce(q.next_attempt_at,q.scheduled_at)<=now() AND (q.post_id IS NOT NULL OR q.attempts<3)
      AND (s.canary_job_id IS NULL OR q.id=s.canary_job_id)
      AND (s.canary_job_id IS NOT NULL OR
           (q.connection_key=ANY(s.active_connection_keys)
            AND NOT (q.connection_key=ANY(s.paused_connection_keys))))
      AND NOT EXISTS (
        SELECT 1 FROM public.facebook_page_write_state w
        WHERE w.connection_key=q.connection_key AND w.retry_at>now()
      )
      AND (q.post_id IS NOT NULL OR public.facebook_rotation_preflight_is_safe(q.id))
      AND p.one_availability='IN_STOCK'
      AND p.status IN ('ready_to_list','published','reserved')
    ORDER BY CASE WHEN q.lane='NEW_ARRIVAL' THEN 0 ELSE 1 END,
      CASE WHEN q.lane='NEW_ARRIVAL' THEN q.scheduled_at END DESC NULLS LAST,
      q.scheduled_at,q.id
    FOR UPDATE OF q SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.facebook_rotation_queue x
      WHERE x.connection_key=j.connection_key AND x.status='CLAIMED'
    ) THEN CONTINUE; END IF;

    -- Shared per-page rolling budget and allowed-hours gate. Failed checks never claim a job.
    IF j.post_id IS NULL AND coalesce((public.facebook_page_publish_gate(j.connection_key)->>'allowed')::boolean,false)=false THEN CONTINUE; END IF;

    -- Resuming a known external post ID only repairs local bookkeeping, never publishes.
    IF j.post_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.facebook_post_ledger l
        WHERE l.product_id=j.product_id AND l.connection_key=j.connection_key
          AND l.status<>'DELETED'
          AND l.published_at>now()-make_interval(hours=>s.min_product_gap_hours)
      ) THEN CONTINUE; END IF;

      IF EXISTS (
        SELECT 1 FROM public.facebook_rotation_queue x
        WHERE x.product_id=j.product_id AND x.connection_key=j.connection_key
          AND x.post_id IS NOT NULL
          AND x.posted_at>now()-make_interval(hours=>s.min_product_gap_hours)
      ) THEN CONTINUE; END IF;

      -- Both lanes obey the 25-minute spacing, not just ROTATION.
      IF EXISTS (
        SELECT 1 FROM public.facebook_rotation_queue x
        WHERE x.connection_key=j.connection_key AND x.post_id IS NOT NULL
          AND x.posted_at>now()-make_interval(mins=>s.min_page_gap_minutes)
      ) OR EXISTS (
        SELECT 1 FROM public.facebook_post_ledger l
        WHERE l.connection_key=j.connection_key AND l.published_at>
          now()-make_interval(mins=>s.min_page_gap_minutes)
      ) THEN CONTINUE; END IF;

      -- UNION removes the duplicate for posts present in both queue and ledger.
      -- Count every post, including NEW_ARRIVAL, under one daily per-Page ceiling.
      IF (
        SELECT count(*) FROM (
          SELECT q2.post_id FROM public.facebook_rotation_queue q2
          WHERE q2.connection_key=j.connection_key AND q2.post_id IS NOT NULL
            AND (q2.posted_at AT TIME ZONE s.timezone)::date=local_today
          UNION
          SELECT l.post_id FROM public.facebook_post_ledger l
          WHERE l.connection_key=j.connection_key AND l.post_id IS NOT NULL
            AND (l.published_at AT TIME ZONE s.timezone)::date=local_today
        ) counted_posts
      )>=s.page_daily_budget THEN CONTINUE; END IF;
    END IF;

    UPDATE public.facebook_rotation_queue
      SET status='CLAIMED',claimed_at=now(),claim_token=gen_random_uuid(),
          attempts=attempts+1
    WHERE id=j.id RETURNING * INTO j;
    RETURN NEXT j;
    picked:=picked+1;
    EXIT WHEN picked>=greatest(1,least(max_jobs,10));
  END LOOP;
END $function$;
CREATE OR REPLACE FUNCTION public.facebook_page_publish_gate(p_connection_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  s public.facebook_rotation_settings%rowtype;
  v_local timestamp;
  v_window_resume timestamptz;
  v_retry timestamptz;
  v_count integer;
  v_last timestamptz;
  v_oldest timestamptz;
BEGIN
  SELECT * INTO s FROM public.facebook_rotation_settings WHERE id=true;
  IF NOT FOUND OR NOT s.enabled OR s.dry_run OR
     NOT p_connection_key=ANY(s.active_connection_keys) OR
     p_connection_key=ANY(s.paused_connection_keys) THEN
    RETURN jsonb_build_object('allowed',false,'retry_at',now()+interval '1 hour','reason','PUBLISH_DISABLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_channel_connections c
                 WHERE c.channel_key='facebook_page' AND c.connection_key=p_connection_key
                   AND c.environment='PRODUCTION' AND c.activation_status='ACTIVE') THEN
    RETURN jsonb_build_object('allowed',false,'retry_at',now()+interval '1 hour','reason','PAGE_NOT_ACTIVE');
  END IF;
  SELECT retry_at INTO v_retry FROM public.facebook_page_write_state WHERE connection_key=p_connection_key;
  IF v_retry>now() THEN
    RETURN jsonb_build_object('allowed',false,'retry_at',v_retry,'reason','PAGE_COOLDOWN');
  END IF;

  -- Meta's usage headers are rolling signals, not a published universal quota.
  -- Hold new publishing for at least 60 minutes if a response reached >= 80%.
  IF EXISTS (
    SELECT 1 FROM public.facebook_graph_usage_samples u
    WHERE u.connection_key=p_connection_key
      AND u.recorded_at>now()-interval '24 hours'
      AND greatest(u.recorded_at+interval '60 minutes',
        u.recorded_at+make_interval(mins=>least(greatest(coalesce(u.business_recovery_minutes,0),0),1440)))>now()
      AND (greatest(coalesce(u.app_call_percent,0),coalesce(u.business_call_percent,0))>=80
           OR coalesce(u.business_recovery_minutes,0)>0)
  ) THEN
    SELECT max(greatest(u.recorded_at+interval '60 minutes',
      u.recorded_at+make_interval(mins=>least(greatest(coalesce(u.business_recovery_minutes,0),0),1440))))
    INTO v_retry FROM public.facebook_graph_usage_samples u
    WHERE u.connection_key=p_connection_key AND u.recorded_at>now()-interval '24 hours'
      AND greatest(u.recorded_at+interval '60 minutes',
        u.recorded_at+make_interval(mins=>least(greatest(coalesce(u.business_recovery_minutes,0),0),1440)))>now()
      AND (greatest(coalesce(u.app_call_percent,0),coalesce(u.business_call_percent,0))>=80
           OR coalesce(u.business_recovery_minutes,0)>0);
    IF v_retry>now() THEN
      RETURN jsonb_build_object('allowed',false,'retry_at',v_retry,
        'reason','META_USAGE_SAFETY_HOLD');
    END IF;
  END IF;
  v_local:=now() AT TIME ZONE s.timezone;
  IF extract(hour FROM v_local)::int<s.publish_window_start_hour OR
     extract(hour FROM v_local)::int>=s.publish_window_end_hour THEN
    v_window_resume:=(
      CASE WHEN extract(hour FROM v_local)::int>=s.publish_window_end_hour
        THEN v_local::date+1 ELSE v_local::date END
      +make_interval(hours=>s.publish_window_start_hour)
    ) AT TIME ZONE s.timezone;
    RETURN jsonb_build_object('allowed',false,'retry_at',v_window_resume,'reason','OUTSIDE_PUBLISHING_HOURS');
  END IF;
  -- Deduplicate by exact Graph post ID: the same external post can appear in
  -- both queue and ledger with slightly different timestamps.
  SELECT count(*)::integer, max(published_at), min(published_at)
    INTO v_count,v_last,v_oldest
  FROM (
    SELECT post_id,min(published_at) AS published_at
    FROM (
      SELECT q.post_id,q.posted_at AS published_at FROM public.facebook_rotation_queue q
      WHERE q.connection_key=p_connection_key AND q.post_id IS NOT NULL
        AND q.posted_at>now()-interval '24 hours'
      UNION ALL
      SELECT l.post_id,l.published_at FROM public.facebook_post_ledger l
      WHERE l.connection_key=p_connection_key AND l.post_id IS NOT NULL
        AND l.published_at>now()-interval '24 hours'
      UNION ALL
      -- A successful /feed HTTP response can be lost before queue ID persistence.
      -- Count the attempt conservatively, and NEVER resubmit its original job.
      -- Reserve one conservative slot when a /feed outcome may be ambiguous.
      -- A confirmed ID is already counted by queue/ledger, and a recorded
      -- successful feed is counted by UNRECONCILED_FEED below.
      SELECT 'PREPARED:'||a.queue_id::text AS post_id,a.started_at AS published_at
      FROM public.facebook_publish_attempts a
      WHERE a.connection_key=p_connection_key AND a.state IN('PREPARED','NEEDS_REVIEW')
        AND a.post_id IS NULL AND a.started_at>now()-interval '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM public.facebook_graph_usage_samples u
          WHERE u.connection_key=a.connection_key AND u.operation='feed-publish'
            AND u.http_status BETWEEN 200 AND 299
            AND u.recorded_at BETWEEN a.started_at AND a.started_at+interval '10 minutes'
        )
      UNION ALL
      SELECT 'UNRECONCILED_FEED:'||u.id::text AS post_id,u.recorded_at AS published_at
      FROM public.facebook_graph_usage_samples u
      JOIN public.facebook_rotation_queue q ON q.connection_key=u.connection_key
        AND q.claimed_at IS NOT NULL
        AND u.recorded_at BETWEEN q.claimed_at AND q.claimed_at+interval '10 minutes'
      WHERE u.connection_key=p_connection_key
        AND u.operation='feed-publish'
        AND u.http_status BETWEEN 200 AND 299
        AND q.post_id IS NULL
        AND q.status IN ('FAILED','CLAIMED','PLANNED')
        AND u.recorded_at>now()-interval '24 hours'
    ) publication_events
    GROUP BY post_id
  ) distinct_posts;
  IF v_count>=least(s.page_daily_budget,s.rolling_24h_budget) THEN
    RETURN jsonb_build_object('allowed',false,
      'retry_at',v_oldest+interval '24 hours 1 second','reason','ROLLING_24H_POST_LIMIT',
      'posts_24h',v_count);
  END IF;
  IF v_last IS NOT NULL AND v_last+make_interval(mins=>s.min_page_gap_minutes)>now() THEN
    RETURN jsonb_build_object('allowed',false,
      'retry_at',v_last+make_interval(mins=>s.min_page_gap_minutes),
      'reason','MIN_PUBLISH_GAP');
  END IF;
  RETURN jsonb_build_object('allowed',true,'posts_24h',coalesce(v_count,0));
END $function$;

-- Seed previously quarantined no-ID responses for one bounded Graph
-- reconciliation attempt. Older posts lack a marker and will be matched only
-- to the exact SKU link plus the original 10-minute claim window.
INSERT INTO public.facebook_publish_attempts(
 queue_id,connection_key,product_id,marker,state,started_at,next_reconcile_at)
SELECT q.id,q.connection_key,q.product_id,NULL,'NEEDS_REVIEW',q.claimed_at,now()
FROM public.facebook_rotation_queue q
WHERE q.post_id IS NULL
 AND q.last_error='FACEBOOK_FEED_HTTP_200_UNRECONCILED_MANUAL_REVIEW_REQUIRED'
 AND q.claimed_at IS NOT NULL
ON CONFLICT(queue_id) DO NOTHING;

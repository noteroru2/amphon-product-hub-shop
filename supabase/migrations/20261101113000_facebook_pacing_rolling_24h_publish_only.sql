-- Recovery controls are store policy, NOT limits certified by Meta.
-- Keep existing Facebook 368 cooldowns and all queue rows unchanged.
ALTER TABLE public.facebook_rotation_settings
 ADD COLUMN IF NOT EXISTS rolling_24h_budget integer NOT NULL DEFAULT 3,
 ADD COLUMN IF NOT EXISTS publish_window_start_hour integer NOT NULL DEFAULT 9,
 ADD COLUMN IF NOT EXISTS publish_window_end_hour integer NOT NULL DEFAULT 21;
UPDATE public.facebook_rotation_settings
SET page_daily_budget=least(page_daily_budget,3),
    rolling_24h_budget=3,min_page_gap_minutes=greatest(min_page_gap_minutes,120),
    publish_window_start_hour=9,publish_window_end_hour=21,updated_at=now()
WHERE id=true;
COMMENT ON COLUMN public.facebook_rotation_settings.rolling_24h_budget IS
'Temporary conservative 24h rolling per-Page post cap for recovery from Meta 368. Not an official Meta limit.';

CREATE OR REPLACE FUNCTION public.facebook_page_publish_gate(p_connection_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $gate$
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
END;
$gate$;
REVOKE ALL ON FUNCTION public.facebook_page_publish_gate(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_page_publish_gate(text) TO service_role;

CREATE OR REPLACE FUNCTION public.facebook_page_write_claim(p_connection_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s public.facebook_page_write_state%rowtype; lease uuid; gate jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sales_channel_connections c
   WHERE c.channel_key='facebook_page' AND c.connection_key=p_connection_key
     AND c.activation_status='ACTIVE' AND c.environment='PRODUCTION') THEN
   RETURN jsonb_build_object('retry_at',now()+interval '1 hour');
 END IF;
 INSERT INTO public.facebook_page_write_state(connection_key) VALUES(p_connection_key)
 ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.facebook_page_write_state
 WHERE connection_key=p_connection_key FOR UPDATE;
 IF s.retry_at>now() THEN RETURN jsonb_build_object('retry_at',s.retry_at); END IF;
 gate:=public.facebook_page_publish_gate(p_connection_key);
 IF coalesce((gate->>'allowed')::boolean,false)=false THEN RETURN gate; END IF;
 lease:=gen_random_uuid();
 UPDATE public.facebook_page_write_state SET token=lease,
 retry_at=now()+interval '5 minutes',updated_at=now() WHERE connection_key=p_connection_key;
 RETURN jsonb_build_object('token',lease);
END $function$;

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
  IF NOT s.enabled OR s.dry_run THEN RETURN; END IF;
  local_today := (now() AT TIME ZONE s.timezone)::date;

  FOR j IN
    SELECT q.* FROM public.facebook_rotation_queue q
    JOIN public.products p ON p.id=q.product_id
    WHERE q.status IN ('PLANNED','FAILED') AND q.scheduled_at<=now()
      AND coalesce(q.next_attempt_at,q.scheduled_at)<=now() AND q.attempts<3
      AND (s.canary_job_id IS NULL OR q.id=s.canary_job_id)
      AND (s.canary_job_id IS NOT NULL OR
           (q.connection_key=ANY(s.active_connection_keys)
            AND NOT (q.connection_key=ANY(s.paused_connection_keys))))
      AND NOT EXISTS (
        SELECT 1 FROM public.facebook_page_write_state w
        WHERE w.connection_key=q.connection_key AND w.retry_at>now()
      )
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


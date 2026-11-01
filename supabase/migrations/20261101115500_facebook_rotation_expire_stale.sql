-- Mirrors the production fix applied on 2026-11-01, preserving 34 cancelled
-- stale rotation jobs (20 page_1, 14 page_2) as history, not deleting posts.
-- Rotation slots older than 48h must not burst-publish after a Meta cooldown.
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

CREATE OR REPLACE FUNCTION public.facebook_rotation_expire_stale(max_age_hours integer DEFAULT 48)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_cancelled integer;
BEGIN
  UPDATE public.facebook_rotation_queue q
  SET status='CANCELLED',
      last_error='ROTATION_SLOT_EXPIRED_REPLAN_NEXT_WEEK',
      next_attempt_at=NULL,claim_token=NULL,claimed_at=NULL
  WHERE q.lane='ROTATION'
    AND q.status IN ('PLANNED','FAILED')
    AND q.post_id IS NULL
    AND q.scheduled_at<now()-make_interval(hours=>greatest(24,least(max_age_hours,168)));
  GET DIAGNOSTICS v_cancelled=ROW_COUNT;
  RETURN v_cancelled;
END $function$;
REVOKE ALL ON FUNCTION public.facebook_rotation_expire_stale(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_rotation_expire_stale(integer) TO service_role;

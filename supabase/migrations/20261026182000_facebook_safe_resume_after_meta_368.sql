-- P0: one combined six-post budget per Facebook Page / Bangkok day.
-- Preserve today's Meta 368 cooldown and keep postponed jobs queued (no forced retries).
-- Includes NEW_ARRIVAL, ROTATION and previously recorded external posts.
CREATE OR REPLACE FUNCTION public.facebook_rotation_claim_due(max_jobs integer DEFAULT 3)
RETURNS SETOF public.facebook_rotation_queue LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.facebook_rotation_claim_due(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_rotation_claim_due(integer) TO service_role;

-- One shared page-level guard already serializes all writes. Widen pacing for edits
-- and make Meta spam/restriction responses trigger a full 24-hour quiet period.
-- Do not shorten any currently active cooldown or invent a Meta unblock time.
CREATE OR REPLACE FUNCTION public.facebook_page_write_result(
  p_connection_key text, p_token uuid, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_retry_at timestamptz;
  v_attempts integer;
  v_is_meta_block boolean;
BEGIN
  v_is_meta_block := p_error IS NOT NULL AND
    p_error ~* '(จำกัดจำนวน|ป้องกันการสแปม|temporarily blocked|rate.limit|too many|:368:|:613:|:4:|:17:|:32:)';
  UPDATE public.facebook_page_write_state SET
    attempts=CASE WHEN p_error IS NULL THEN 0 ELSE least(attempts+1,10) END,
    retry_at=GREATEST(retry_at,now()+CASE
      WHEN p_error IS NULL THEN interval '20 minutes'
      WHEN v_is_meta_block THEN interval '24 hours'
      ELSE interval '5 minutes'*least(power(2,least(attempts,3)),8)
    END),
    last_error=left(p_error,800),token=NULL,updated_at=now()
  WHERE connection_key=p_connection_key AND token=p_token
  RETURNING retry_at,attempts INTO v_retry_at,v_attempts;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_is_meta_block THEN
    INSERT INTO public.distribution_alerts(
      alert_key,alert_type,severity,connection_key,details,
      last_seen_at,resolved_at,status
    ) VALUES (
      'FB_RATE_LIMIT:'||p_connection_key,'FACEBOOK_RATE_LIMITED','CRITICAL',
      p_connection_key,
      jsonb_build_object('error',left(p_error,350),
        'retryAt',v_retry_at,'attempts',v_attempts,'reason','META_WRITE_RESTRICTION'),
      now(),NULL,'OPEN'
    )
    ON CONFLICT(alert_key) DO UPDATE SET
      severity='CRITICAL',details=EXCLUDED.details,last_seen_at=now(),
      resolved_at=NULL,status='OPEN';
  ELSIF p_error IS NULL THEN
    UPDATE public.distribution_alerts SET status='RESOLVED',
      resolved_at=now(),last_seen_at=now()
    WHERE alert_key='FB_RATE_LIMIT:'||p_connection_key AND status='OPEN';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.facebook_page_write_result(text,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_page_write_result(text,uuid,text) TO service_role;

-- Surface the restrictions already persisted from today's failed sold edits.
INSERT INTO public.distribution_alerts(
  alert_key,alert_type,severity,connection_key,details,
  last_seen_at,resolved_at,status
)
SELECT 'FB_RATE_LIMIT:'||connection_key,'FACEBOOK_RATE_LIMITED','CRITICAL',
  connection_key,
  jsonb_build_object('error',left(last_error,350),'retryAt',retry_at,
    'attempts',attempts,'reason','META_WRITE_RESTRICTION'),
  now(),NULL,'OPEN'
FROM public.facebook_page_write_state
WHERE retry_at>now()
  AND last_error ~* '(จำกัดจำนวน|ป้องกันการสแปม|temporarily blocked|:368:)'
ON CONFLICT(alert_key) DO UPDATE SET
  severity='CRITICAL',details=EXCLUDED.details,last_seen_at=now(),
  resolved_at=NULL,status='OPEN';

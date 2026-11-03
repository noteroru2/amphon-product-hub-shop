-- Owner/Admin only calls this via the authenticated commerce Worker.
-- It never calls Graph. The existing atomic prepared/captured attempt path
-- handles the eventual publish, including uncertain-receipt recovery.
CREATE OR REPLACE FUNCTION public.facebook_manual_publish_enqueue(
  p_product_id uuid,p_connection_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $manual$
DECLARE
 p public.products%rowtype;
 q public.facebook_rotation_queue%rowtype;
 v_post text;
BEGIN
 -- Serializes repeated owner clicks across tabs and employees.
 SELECT * INTO p FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF NOT FOUND OR p.one_availability<>'IN_STOCK'
   OR p.status NOT IN ('ready_to_list','published','reserved')
   OR NOT EXISTS(SELECT 1 FROM public.commerce_public_listing_v l
     WHERE l.product_id=p_product_id AND l.price>0) THEN
   RETURN jsonb_build_object('ok',false,'status','NOT_PUBLISHABLE');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_channel_connections c
   WHERE c.channel_key='facebook_page' AND c.connection_key=p_connection_key
     AND c.environment='PRODUCTION' AND c.activation_status='ACTIVE') THEN
   RETURN jsonb_build_object('ok',false,'status','PAGE_NOT_ACTIVE');
 END IF;
 -- Preserve existing manual semantics: a LIVE post is reused rather than
 -- creating a duplicate of the same stock unit.
 SELECT l.post_id INTO v_post FROM public.facebook_post_ledger l
 WHERE l.product_id=p_product_id AND l.connection_key=p_connection_key
   AND l.status='LIVE'
 ORDER BY l.published_at DESC LIMIT 1;
 IF v_post IS NOT NULL THEN
   RETURN jsonb_build_object('ok',true,'status','ALREADY_PUBLISHED','postId',v_post);
 END IF;
 SELECT * INTO q FROM public.facebook_rotation_queue x
 WHERE x.product_id=p_product_id AND x.connection_key=p_connection_key
   AND x.status IN ('PLANNED','CLAIMED','FAILED')
 ORDER BY CASE WHEN x.status='CLAIMED' THEN 0
               WHEN x.status='PLANNED' THEN 1 ELSE 2 END,
          x.created_at DESC
 LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   IF q.post_id IS NOT NULL THEN
     RETURN jsonb_build_object('ok',true,'status','REPAIR_PENDING','queueId',q.id,'postId',q.post_id);
   END IF;
   IF q.attempts>=3 OR
      EXISTS(SELECT 1 FROM public.facebook_publish_attempts a
        WHERE a.queue_id=q.id AND a.state<>'REJECTED') THEN
     RETURN jsonb_build_object('ok',false,'status','NEEDS_REVIEW','queueId',q.id);
   END IF;
   IF q.status='CLAIMED' THEN
     RETURN jsonb_build_object('ok',true,'status','IN_PROGRESS','queueId',q.id);
   END IF;
   UPDATE public.facebook_rotation_queue
   SET status='PLANNED',scheduled_at=least(scheduled_at,now()),
       next_attempt_at=NULL,last_error=NULL,template_id='MANUAL-1'
   WHERE id=q.id;
   RETURN jsonb_build_object('ok',true,'status','QUEUED','queueId',q.id,'reusedQueue',true);
 END IF;
 -- A previously disputed Graph success must never be re-published manually.
 IF EXISTS(SELECT 1 FROM public.facebook_publish_attempts a
   WHERE a.product_id=p_product_id AND a.connection_key=p_connection_key
     AND a.state IN ('PREPARED','NEEDS_REVIEW')) THEN
   RETURN jsonb_build_object('ok',false,'status','NEEDS_REVIEW');
 END IF;
 INSERT INTO public.facebook_rotation_queue(
  product_id,connection_key,lane,rotation_no,template_id,week_key,scheduled_at,status)
 VALUES(p_product_id,p_connection_key,'ROTATION',1,'MANUAL-1',
        'MANUAL-'||replace(gen_random_uuid()::text,'-',''),now(),'PLANNED')
 RETURNING * INTO q;
 RETURN jsonb_build_object('ok',true,'status','QUEUED','queueId',q.id,'reusedQueue',false);
END
$manual$;
REVOKE ALL ON FUNCTION public.facebook_manual_publish_enqueue(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_manual_publish_enqueue(uuid,text) TO service_role;

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
    ORDER BY
      -- Owner action is next in line, but still obeys page quota/gap/cooldown.
      CASE WHEN q.template_id='MANUAL-1' THEN 0
           WHEN q.lane='NEW_ARRIVAL' THEN 1 ELSE 2 END,
      CASE WHEN q.lane='NEW_ARRIVAL' THEN q.scheduled_at END DESC NULLS LAST,
      CASE WHEN q.lane='ROTATION' THEN
        -- Prioritize aged stock, while rotating away from categories
        -- dominating the last three recorded posts on the same Page.
        greatest(0,least(coalesce(p.one_stock_age_days,0),120))
        - 8 * (
          SELECT count(*) FROM (
            SELECT rp.product_id FROM public.facebook_post_ledger rp
            WHERE rp.connection_key=q.connection_key AND rp.published_at IS NOT NULL
            ORDER BY rp.published_at DESC LIMIT 3
          ) recent
          JOIN public.products prev ON prev.id=recent.product_id
          WHERE coalesce(prev.category,'other')=coalesce(p.category,'other')
        )
      END DESC NULLS LAST,
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

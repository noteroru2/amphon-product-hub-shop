-- Facebook Graph API per-request metrics, only non-secret sanitized diagnostics.
-- Track both success and failures, block publishing when usage >=80%.
-- 80% and 60 minute hold are conservative merchant guardrails, NOT Meta policy.
CREATE TABLE IF NOT EXISTS public.facebook_graph_usage_samples (
 id bigserial PRIMARY KEY,
 connection_key text NOT NULL,
 operation text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 http_status integer NOT NULL,
 error_code integer,
 error_subcode integer,
 fbtrace_id text,
 app_call_percent numeric,
 business_call_percent numeric,
 business_recovery_minutes integer,
 CONSTRAINT fb_usage_operation_length CHECK (length(operation) BETWEEN 1 AND 64),
 CONSTRAINT fb_usage_status_check CHECK (http_status BETWEEN 100 AND 599),
 CONSTRAINT fb_usage_percent_nonnegative CHECK (
  coalesce(app_call_percent,0)>=0 AND coalesce(business_call_percent,0)>=0)
);
CREATE INDEX IF NOT EXISTS fb_graph_usage_page_recent_idx
 ON public.facebook_graph_usage_samples(connection_key,recorded_at DESC);
ALTER TABLE public.facebook_graph_usage_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_graph_usage_samples FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.facebook_graph_usage_samples_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.facebook_graph_usage_samples TO service_role;
GRANT USAGE ON SEQUENCE public.facebook_graph_usage_samples_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.facebook_graph_usage_record(
 p_connection_key text,p_operation text,p_http_status integer,
 p_error_code integer DEFAULT NULL,p_error_subcode integer DEFAULT NULL,
 p_fbtrace_id text DEFAULT NULL,p_app_call_percent numeric DEFAULT NULL,
 p_business_call_percent numeric DEFAULT NULL,p_business_recovery_minutes integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $fn$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.sales_channel_connections c
  WHERE c.channel_key='facebook_page' AND c.connection_key=p_connection_key) THEN
  RETURN;
 END IF;
 INSERT INTO public.facebook_graph_usage_samples
 (connection_key,operation,http_status,error_code,error_subcode,fbtrace_id,
  app_call_percent,business_call_percent,business_recovery_minutes)
 VALUES (p_connection_key,left(p_operation,64),p_http_status,p_error_code,p_error_subcode,
  left(p_fbtrace_id,120),p_app_call_percent,p_business_call_percent,p_business_recovery_minutes);
END;
$fn$;
REVOKE ALL ON FUNCTION public.facebook_graph_usage_record(
 text,text,integer,integer,integer,text,numeric,numeric,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_graph_usage_record(
 text,text,integer,integer,integer,text,numeric,numeric,integer)
 TO service_role;

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
CREATE OR REPLACE FUNCTION public.facebook_page_write_result(p_connection_key text, p_token uuid, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_retry_at timestamptz;
  v_attempts integer;
  v_is_meta_block boolean;
BEGIN
  v_is_meta_block := p_error IS NOT NULL AND
    p_error ~* '(จำกัดจำนวน|ป้องกันการสแปม|temporarily blocked|rate.limit|too many|:368:|:80001:|:613:|:4:|:17:|:32:)';
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
END $function$;

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

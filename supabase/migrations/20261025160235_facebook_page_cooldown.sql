-- Shared server-only reservation and backoff. Never mark a blocked post SOLD.
CREATE TABLE public.facebook_page_write_state (
 connection_key text PRIMARY KEY,
 retry_at timestamptz NOT NULL DEFAULT now(),
 token uuid,
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facebook_page_write_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_page_write_state FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.facebook_page_write_state TO service_role;

CREATE FUNCTION public.facebook_page_write_claim(p_connection_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.facebook_page_write_state%rowtype; lease uuid;
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
 lease:=gen_random_uuid();
 UPDATE public.facebook_page_write_state SET token=lease,
 retry_at=now()+interval '5 minutes',updated_at=now() WHERE connection_key=p_connection_key;
 RETURN jsonb_build_object('token',lease);
END $$;

CREATE FUNCTION public.facebook_page_write_result(p_connection_key text,p_token uuid,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.facebook_page_write_state SET
   attempts=CASE WHEN p_error IS NULL THEN 0 ELSE least(attempts+1,10) END,
   retry_at=now()+CASE
     WHEN p_error IS NULL THEN interval '2 minutes'
     WHEN p_error ~* '(จำกัดจำนวน|ป้องกันการสแปม|temporarily blocked|rate.limit|too many|:368:|:613:|:4:|:17:|:32:)' THEN
       interval '6 hours'*least(power(2,least(attempts,2)),4)
     ELSE interval '5 minutes'*least(power(2,least(attempts,3)),8) END,
   last_error=left(p_error,800),token=NULL,updated_at=now()
 WHERE connection_key=p_connection_key AND token=p_token;
END $$;
REVOKE ALL ON FUNCTION public.facebook_page_write_claim(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.facebook_page_write_result(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_page_write_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.facebook_page_write_result(text,uuid,text) TO service_role;

-- Honour the restriction already returned by Meta, instead of immediately probing again.
INSERT INTO public.facebook_page_write_state(connection_key,retry_at,attempts,last_error)
SELECT connection_key,max(updated_at)+interval '6 hours',1,max(last_error)
FROM public.facebook_post_ledger
WHERE last_error ~* '(จำกัดจำนวน|ป้องกันการสแปม|temporarily blocked|rate.limit|too many)'
AND updated_at>now()-interval '6 hours' GROUP BY connection_key;

CREATE OR REPLACE FUNCTION public.facebook_sold_sync_candidates(max_posts integer DEFAULT 20)
RETURNS TABLE(id uuid,product_id uuid,connection_key text,post_id text,sold_at timestamptz,sku text,title text)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT x.id,x.product_id,x.connection_key,x.post_id,x.sold_at,x.sku,x.title
 FROM (
   SELECT DISTINCT ON(l.connection_key) l.id,l.product_id,l.connection_key,l.post_id,p.sold_at,p.sku,p.title,l.updated_at
   FROM public.facebook_post_ledger l JOIN public.products p ON p.id=l.product_id
   JOIN public.sales_channel_connections c ON c.channel_key='facebook_page' AND c.connection_key=l.connection_key
   LEFT JOIN public.facebook_page_write_state s ON s.connection_key=l.connection_key
   WHERE (p.status='sold' OR p.one_availability='SOLD') AND l.status IN ('LIVE','SOLD')
     AND l.content_hash IS DISTINCT FROM 'SOLD_CONTENT_V2'
     AND c.activation_status='ACTIVE' AND c.environment='PRODUCTION'
     AND (s.retry_at IS NULL OR s.retry_at<=now())
   ORDER BY l.connection_key,l.updated_at,l.id
 ) x ORDER BY x.updated_at,x.id LIMIT greatest(1,least(max_posts,50))
$$;

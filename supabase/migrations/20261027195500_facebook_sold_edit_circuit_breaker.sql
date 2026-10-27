-- Publish-safe recovery after Meta 368 on editing previously published sold posts.
-- Do not bypass or shorten any Meta-triggered page cooldown.
-- Keep NEW_ARRIVAL and ROTATION active while pausing ONLY the automatic sold-post
-- edit sweep. The 63 unedited sold posts remain in the ledger for later repair.
ALTER TABLE public.facebook_rotation_settings
  ADD COLUMN IF NOT EXISTS sold_sync_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.facebook_rotation_settings.sold_sync_paused IS
  'Temporary circuit breaker for automatic Facebook sold-post editing after Meta 368. Posting and queue processing remain enabled. Re-enable only when existing-post editing is verified by Meta.';

-- Both production Pages recently returned code 368 for the same sold-edit action.
UPDATE public.facebook_rotation_settings
SET sold_sync_paused=true,updated_at=now()
WHERE id=true;

CREATE OR REPLACE FUNCTION public.facebook_sold_sync_candidates(max_posts integer DEFAULT 20)
RETURNS TABLE(
  id uuid,product_id uuid,connection_key text,post_id text,
  sold_at timestamptz,sku text,title text
)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT x.id,x.product_id,x.connection_key,x.post_id,x.sold_at,x.sku,x.title
 FROM (
   SELECT DISTINCT ON(l.connection_key)
     l.id,l.product_id,l.connection_key,l.post_id,
     p.sold_at,p.sku,p.title,l.updated_at
   FROM public.facebook_post_ledger l
   JOIN public.products p ON p.id=l.product_id
   JOIN public.sales_channel_connections c
     ON c.channel_key='facebook_page' AND c.connection_key=l.connection_key
   LEFT JOIN public.facebook_page_write_state w
     ON w.connection_key=l.connection_key
   WHERE EXISTS (
       SELECT 1 FROM public.facebook_rotation_settings s
       WHERE s.id=true AND s.sold_sync_paused=false
     )
     AND (p.status='sold' OR p.one_availability='SOLD')
     AND l.status IN ('LIVE','SOLD')
     AND l.content_hash IS DISTINCT FROM 'SOLD_CONTENT_V2'
     AND c.activation_status='ACTIVE' AND c.environment='PRODUCTION'
     AND (w.retry_at IS NULL OR w.retry_at<=now())
   ORDER BY l.connection_key,l.updated_at,l.id
 ) x
 ORDER BY x.updated_at,x.id
 LIMIT greatest(1,least(max_posts,50))
$$;
REVOKE ALL ON FUNCTION public.facebook_sold_sync_candidates(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.facebook_sold_sync_candidates(integer)
  TO service_role;

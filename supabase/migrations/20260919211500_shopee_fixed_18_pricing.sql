-- AMPHON Shopee assisted pricing policy: fixed +18% for every manual listing.
-- This updates staff-facing channel configuration only. It does not enable direct Shopee API publishing.

update public.sales_channel_registry
   set config = coalesce(config, '{}'::jsonb)
     || jsonb_build_object(
       'manual_markup_percent', 18,
       'manual_markup_min_percent', 18,
       'manual_markup_max_percent', 18,
       'pricing_rounding', 'CEIL_10_THB'
     ),
       updated_at = now()
 where channel_key = 'shopee';

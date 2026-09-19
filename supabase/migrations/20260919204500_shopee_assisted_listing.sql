-- Enable Shopee as an assisted/manual channel while direct API remains disabled.
-- Staff receives a complete listing package from Hub and publishes in Seller Centre.

update public.sales_channel_registry
   set adapter_mode = 'assisted',
       enabled = true,
       auto_publish = false,
       projects_stock = false,
       requires_external_auth = false,
       capabilities = '["publish","update_content","update_price","end_listing"]'::jsonb,
       config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
         'manual_markup_percent', 20,
         'manual_markup_min_percent', 18,
         'manual_markup_max_percent', 20,
         'pricing_rounding', 'CEIL_10_THB',
         'seller_centre_url', 'https://seller.shopee.co.th/'
       ),
       updated_at = now()
 where channel_key = 'shopee';

-- The legacy direct Open Platform runtime stays fail-closed.
update public.shopee_settings
   set auto_publish_enabled = false,
       updated_at = now()
 where id = 1;

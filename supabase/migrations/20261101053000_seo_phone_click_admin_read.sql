-- Read access to privacy-preserving phone CTA aggregates: active owner/admin only.
-- Writes remain exclusively service_role via Edge Function; anon has no read grant.
grant select on public.commerce_seo_phone_click_daily to authenticated;
drop policy if exists commerce_seo_phone_click_daily_admin_read on public.commerce_seo_phone_click_daily;
create policy commerce_seo_phone_click_daily_admin_read
on public.commerce_seo_phone_click_daily for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id=(select auth.uid()) and p.active=true and p.role in ('owner','admin')
  )
);

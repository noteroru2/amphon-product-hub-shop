-- First-party aggregate phone CTA measurement without GA4, visitor identifiers, or phone numbers.
-- Server-only write; no public Data API access. Metrics are event counts, NOT leads/sales.
create table if not exists public.commerce_seo_phone_click_daily (
  site_id text not null references public.commerce_seo_sites(id),
  page text not null check (char_length(page) between 8 and 1024),
  event_day date not null,
  source_channel text not null check (char_length(source_channel) between 1 and 40),
  clicks integer not null default 0 check (clicks between 0 and 10000),
  updated_at timestamptz not null default now(),
  primary key (site_id,page,event_day,source_channel)
);
alter table public.commerce_seo_phone_click_daily enable row level security;
revoke all on public.commerce_seo_phone_click_daily from public, anon, authenticated;
grant select, insert, update on public.commerce_seo_phone_click_daily to service_role;
create or replace function public.seo_phone_click_increment(p_site_id text,p_page text,p_source_channel text)
returns void language plpgsql security invoker set search_path='' as $function$
begin
 if p_site_id is null or p_page is null or char_length(p_page) not between 8 and 1024
    or p_source_channel is null or char_length(p_source_channel) not between 1 and 40 then
   raise exception 'Invalid phone CTA event';
 end if;
 insert into public.commerce_seo_phone_click_daily(site_id,page,event_day,source_channel,clicks)
 values(p_site_id,p_page,(now() at time zone 'Asia/Bangkok')::date,p_source_channel,1)
 on conflict(site_id,page,event_day,source_channel)
 do update set clicks=least(10000,public.commerce_seo_phone_click_daily.clicks+1),updated_at=now();
end;
$function$;
revoke all on function public.seo_phone_click_increment(text,text,text) from public, anon, authenticated;
grant execute on function public.seo_phone_click_increment(text,text,text) to service_role;
comment on table public.commerce_seo_phone_click_daily is
 'Aggregate first-party phone CTA clicks by site/page/day/coarse referrer; no phone numbers or visitor/session ids. Not equivalent to a confirmed lead.';

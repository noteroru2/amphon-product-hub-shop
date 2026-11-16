-- Existing applied migration captured verbatim from Supabase on 2026-11-16.
create or replace view public.commerce_seo_portfolio_gsc_windows_v with (security_invoker=true) as
with latest as (
 select distinct on (site_id) site_id,id,source_at,data_start_date,data_end_date,
  last_data_date,clicks,impressions,ctr,position,daily,query_truncated
 from public.commerce_seo_network_snapshots
 where coverage='SITE_TOTAL' and data_end_date is not null
 order by site_id,data_end_date desc,source_at desc
),
daily as (
 select l.site_id,l.id as snapshot_id,l.data_end_date,
        d.date::date as metric_date,d.clicks,d.impressions,d.position
 from latest l
 cross join lateral jsonb_to_recordset(coalesce(l.daily,'[]'::jsonb))
   as d(date text,clicks numeric,impressions numeric,ctr numeric,position numeric)
 where d.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
),
windows as (select unnest(array[7,14,28]) as days)
select l.site_id,l.id as snapshot_id,w.days as window_days,
       (l.data_end_date-(w.days-1))::date as start_date,l.data_end_date as end_date,
       case when w.days=28 then l.clicks else coalesce(sum(d.clicks),0) end as clicks,
       case when w.days=28 then l.impressions else coalesce(sum(d.impressions),0) end as impressions,
       case when w.days=28 then l.ctr
            else coalesce(sum(d.clicks),0)/nullif(sum(d.impressions),0) end as ctr,
       case when w.days=28 then l.position
            else sum(d.position*d.impressions)/nullif(sum(d.impressions),0) end as position,
       count(d.metric_date) as dates_present,
       case when w.days=28 then 'GSC_FINAL_PROPERTY_TOTAL'
            else 'GSC_FINAL_DAILY_ROLLUP' end as provenance,
       l.source_at,l.query_truncated
from latest l cross join windows w
left join daily d on d.site_id=l.site_id
 and d.metric_date between l.data_end_date-(w.days-1) and l.data_end_date
group by l.site_id,l.id,l.data_end_date,l.clicks,l.impressions,l.ctr,l.position,l.source_at,l.query_truncated,w.days;


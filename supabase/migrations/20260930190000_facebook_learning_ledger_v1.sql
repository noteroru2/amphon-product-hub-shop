create table if not exists public.facebook_learning_ledger(
 id uuid primary key default gen_random_uuid(), queue_id uuid unique references public.facebook_rotation_queue(id) on delete set null,
 product_id uuid references public.products(id) on delete set null, connection_key text not null, post_id text not null unique,
 template_id text, posted_at timestamptz not null, local_hour smallint, local_dow smallint,
 impressions bigint, reach bigint, engaged_users bigint, reactions bigint, comments bigint, shares bigint, clicks bigint,
 metric_status text not null default 'PENDING' check(metric_status in('PENDING','COLLECTED','UNAVAILABLE','ERROR')),
 metric_error text, measured_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists facebook_learning_ledger_pending_idx on public.facebook_learning_ledger(metric_status,posted_at);
alter table public.facebook_learning_ledger enable row level security;
drop policy if exists facebook_learning_service_all on public.facebook_learning_ledger;
create policy facebook_learning_service_all on public.facebook_learning_ledger for all to service_role using(true) with check(true);
create or replace view public.facebook_learning_feedback_v as select connection_key,template_id,local_dow,local_hour,count(*) filter(where metric_status='COLLECTED') samples,avg(reach)::numeric(12,2) avg_reach,avg(impressions)::numeric(12,2) avg_impressions,avg(coalesce(reactions,0)+coalesce(comments,0)*2+coalesce(shares,0)*3+coalesce(clicks,0))::numeric(12,2) avg_weighted_engagement from public.facebook_learning_ledger group by connection_key,template_id,local_dow,local_hour;
revoke all on public.facebook_learning_ledger from anon,authenticated; grant all on public.facebook_learning_ledger to service_role; grant select on public.facebook_learning_feedback_v to service_role;
create table if not exists public.facebook_rotation_settings (
 id boolean primary key default true check (id), enabled boolean not null default false, dry_run boolean not null default true,
 posts_per_product_per_week integer not null default 2 check (posts_per_product_per_week between 1 and 3),
 min_page_gap_minutes integer not null default 20 check (min_page_gap_minutes between 10 and 180),
 min_product_gap_hours integer not null default 48 check (min_product_gap_hours between 24 and 120),
 timezone text not null default 'Asia/Bangkok', page_daily_budget integer not null default 12 check (page_daily_budget between 1 and 50), updated_at timestamptz not null default now());
insert into public.facebook_rotation_settings(id) values(true) on conflict(id) do nothing;
alter table public.facebook_rotation_settings enable row level security;
revoke all on public.facebook_rotation_settings from anon,authenticated; grant all on public.facebook_rotation_settings to service_role;
create table if not exists public.facebook_rotation_queue (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade, connection_key text not null,
 scheduled_at timestamptz not null, week_key text not null, rotation_no integer not null check(rotation_no between 1 and 3), template_id text not null,
 status text not null default 'PLANNED' check(status in ('PLANNED','CLAIMED','POSTED','SKIPPED_SOLD','SKIPPED_BUDGET','FAILED','CANCELLED')),
 post_id text, attempts integer not null default 0, last_error text, created_at timestamptz not null default now(), posted_at timestamptz,
 unique(product_id,connection_key,week_key,rotation_no));
create index if not exists facebook_rotation_queue_due_idx on public.facebook_rotation_queue(status,scheduled_at);
create index if not exists facebook_rotation_queue_product_idx on public.facebook_rotation_queue(product_id,week_key);
alter table public.facebook_rotation_queue enable row level security;
revoke all on public.facebook_rotation_queue from anon,authenticated; grant all on public.facebook_rotation_queue to service_role;
create or replace function public.facebook_rotation_cancel_sold() returns integer language plpgsql security definer set search_path=public as $$ declare n integer; begin
 update public.facebook_rotation_queue q set status='SKIPPED_SOLD',last_error='PRODUCT_SOLD_OR_UNPUBLISHED'
 where q.status in ('PLANNED','CLAIMED') and exists(select 1 from public.products p where p.id=q.product_id and p.status not in ('ready_to_list','published','reserved'));
 get diagnostics n=row_count; return n; end $$;
revoke all on function public.facebook_rotation_cancel_sold() from public,anon,authenticated; grant execute on function public.facebook_rotation_cancel_sold() to service_role;
create table if not exists public.facebook_post_ledger (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.products(id) on delete cascade,
 connection_key text not null, page_id text not null, post_id text not null,
 status text not null default 'LIVE' check (status in ('LIVE','SOLD','DELETED','ERROR')),
 content_hash text, external_url text, published_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), sold_at timestamptz, last_error text,
 unique(product_id,connection_key)
);
create index if not exists facebook_post_ledger_product_idx on public.facebook_post_ledger(product_id);
alter table public.facebook_post_ledger enable row level security;
revoke all on public.facebook_post_ledger from anon,authenticated;
grant all on public.facebook_post_ledger to service_role;
-- AMPHON Product Hub — Batch 4 Publish Center
-- Run once after Batch 3.4. Safe to re-run.

create table if not exists public.product_publications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  channel text not null check (channel in ('facebook','marketplace','winner_it','website')),
  status text not null default 'not_published' check (status in ('not_published','published','ended')),
  external_url text,
  listing_ref text,
  notes text,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  published_by_name text,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  ended_by_name text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, channel)
);

create index if not exists product_publications_product_idx
on public.product_publications(product_id, channel);

create index if not exists product_publications_status_idx
on public.product_publications(status, updated_at desc);

create or replace function public.touch_product_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_publications_touch on public.product_publications;
create trigger product_publications_touch
before update on public.product_publications
for each row execute procedure public.touch_product_publication();

alter table public.product_publications enable row level security;

drop policy if exists publications_read_authenticated on public.product_publications;
drop policy if exists publications_insert_sales on public.product_publications;
drop policy if exists publications_update_sales on public.product_publications;
drop policy if exists publications_delete_admin on public.product_publications;

create policy publications_read_authenticated on public.product_publications
for select to authenticated
using (public.current_user_active());

create policy publications_insert_sales on public.product_publications
for insert to authenticated
with check (
  public.current_user_role() in ('owner','admin','sales')
  and updated_by = auth.uid()
);

create policy publications_update_sales on public.product_publications
for update to authenticated
using (public.current_user_role() in ('owner','admin','sales'))
with check (
  public.current_user_role() in ('owner','admin','sales')
  and updated_by = auth.uid()
);

create policy publications_delete_admin on public.product_publications
for delete to authenticated
using (public.current_user_role() in ('owner','admin'));

-- Multiple phones/tablets see channel status changes without manual refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.product_publications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

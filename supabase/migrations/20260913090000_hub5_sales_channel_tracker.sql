-- HUB-5 — Sales Channel Publication Tracker
-- Additive extension of the existing normalized product_publications model.

alter table public.product_publications
  add column if not exists last_action_id uuid;

alter table public.product_publications
  drop constraint if exists product_publications_channel_check;

alter table public.product_publications
  add constraint product_publications_channel_check
  check (channel in ('facebook','marketplace','winner_it','website','line'));

alter table public.product_publications
  drop constraint if exists product_publications_status_check;

alter table public.product_publications
  add constraint product_publications_status_check
  check (status in ('not_published','published','ended','expired'));

create table if not exists public.sales_channel_publication_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique,
  publication_id uuid not null references public.product_publications(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete cascade,
  channel text not null check (channel in ('facebook','marketplace','winner_it','website','line')),
  event_type text not null check (event_type in ('posted','shared','updated','removed','expired','reset')),
  previous_status text check (previous_status is null or previous_status in ('not_published','published','ended','expired')),
  new_status text not null check (new_status in ('not_published','published','ended','expired')),
  external_url text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sales_channel_events_product_idx
on public.sales_channel_publication_events(product_id, occurred_at desc);

create index if not exists sales_channel_events_active_audit_idx
on public.sales_channel_publication_events(channel, new_status, occurred_at desc);

create or replace function public.record_sales_channel_publication_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_kind text;
  event_time timestamptz;
  safe_actor_name text;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.external_url is not distinct from old.external_url
     and new.listing_ref is not distinct from old.listing_ref
     and new.notes is not distinct from old.notes
     and new.last_action_id is not distinct from old.last_action_id then
    return new;
  end if;

  event_kind := case
    when new.status = 'published' and new.channel = 'line' then 'shared'
    when new.status = 'published' then 'posted'
    when new.status = 'ended' then 'removed'
    when new.status = 'expired' then 'expired'
    when new.status = 'not_published' then 'reset'
    else 'updated'
  end;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    event_kind := case when new.channel = 'line' then 'shared' else 'updated' end;
  end if;

  event_time := case
    when new.status = 'published' then coalesce(new.published_at, now())
    when new.status in ('ended','expired') then coalesce(new.ended_at, now())
    else now()
  end;

  select p.display_name into safe_actor_name
  from public.profiles p
  where p.id = new.updated_by;

  insert into public.sales_channel_publication_events(
    action_id, publication_id, product_id, channel, event_type,
    previous_status, new_status, external_url, actor_id, actor_name, occurred_at
  ) values (
    coalesce(new.last_action_id, gen_random_uuid()), new.id, new.product_id, new.channel, event_kind,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, new.external_url, new.updated_by,
    coalesce(nullif(safe_actor_name, ''), nullif(new.updated_by_name, ''), 'พนักงาน'), event_time
  )
  on conflict (action_id) do nothing;

  return new;
end;
$$;

drop trigger if exists product_publications_audit_event on public.product_publications;
create trigger product_publications_audit_event
after insert or update of status, external_url, listing_ref, notes, last_action_id
on public.product_publications
for each row execute procedure public.record_sales_channel_publication_event();

alter table public.sales_channel_publication_events enable row level security;

drop policy if exists sales_channel_events_read_authenticated on public.sales_channel_publication_events;
create policy sales_channel_events_read_authenticated
on public.sales_channel_publication_events
for select to authenticated
using (public.current_user_active());

-- History is written only by the database trigger. Employees cannot alter or delete it.
revoke all on public.sales_channel_publication_events from anon;
revoke insert, update, delete on public.sales_channel_publication_events from authenticated;
grant select on public.sales_channel_publication_events to authenticated;
grant select, insert, update, delete on public.sales_channel_publication_events to service_role;

-- HUB-5 uses lifecycle transitions, never hard delete, for current publication rows.
drop policy if exists publications_delete_admin on public.product_publications;
revoke delete on public.product_publications from authenticated;

comment on table public.sales_channel_publication_events is
'Append-only employee-reported sales-channel publication history. No external platform confirmation is implied.';

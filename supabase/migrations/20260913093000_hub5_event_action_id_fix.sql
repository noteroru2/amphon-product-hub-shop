-- HUB-5 follow-up: preserve automatic Website lifecycle events even when the
-- source row still carries the previous client action id.

create or replace function public.record_sales_channel_publication_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_kind text;
  event_time timestamptz;
  event_action_id uuid;
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
  event_action_id := case
    when tg_op = 'INSERT' then coalesce(new.last_action_id, gen_random_uuid())
    when new.last_action_id is distinct from old.last_action_id then coalesce(new.last_action_id, gen_random_uuid())
    else gen_random_uuid()
  end;

  select p.display_name into safe_actor_name
  from public.profiles p
  where p.id = new.updated_by;

  insert into public.sales_channel_publication_events(
    action_id, publication_id, product_id, channel, event_type,
    previous_status, new_status, external_url, actor_id, actor_name, occurred_at
  ) values (
    event_action_id, new.id, new.product_id, new.channel, event_kind,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, new.external_url, new.updated_by,
    coalesce(nullif(safe_actor_name, ''), nullif(new.updated_by_name, ''), 'พนักงาน'), event_time
  )
  on conflict (action_id) do nothing;

  return new;
end;
$$;

-- NEW_ARRIVAL uses rotation 0; recurring ROTATION retains slots 1..3.
alter table public.facebook_rotation_queue
  drop constraint if exists facebook_rotation_queue_rotation_no_check;
alter table public.facebook_rotation_queue
  add constraint facebook_rotation_queue_rotation_no_check
  check (
    (lane = 'NEW_ARRIVAL' and rotation_no = 0)
    or (lane = 'ROTATION' and rotation_no between 1 and 3)
  );

create or replace function public.facebook_enqueue_new_arrival()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  k text;
  pages text[];
  became_ready boolean;
begin
  became_ready :=
    new.one_listing_readiness = 'READY_TO_LIST'
    and new.one_availability = 'IN_STOCK'
    and new.status in ('ready_to_list', 'published', 'reserved')
    and (
      tg_op = 'INSERT'
      or old.one_listing_readiness is distinct from 'READY_TO_LIST'
      or old.one_availability is distinct from 'IN_STOCK'
      or old.status not in ('ready_to_list', 'published', 'reserved')
    );

  -- Legacy products have NULL ONE readiness. SQL NOT NULL is still NULL,
  -- so "if not became_ready" wrongly queued every legacy product edit.
  if became_ready is not true then
    return new;
  end if;

  select active_connection_keys into pages
  from public.facebook_rotation_settings
  where id = true and enabled = true and dry_run = false;

  foreach k in array coalesce(pages, array[]::text[]) loop
    insert into public.facebook_rotation_queue (
      product_id, connection_key, scheduled_at, week_key,
      rotation_no, template_id, status, lane
    ) values (
      new.id, k, now() + interval '5 minutes',
      'NEW-' || to_char(now() at time zone 'Asia/Bangkok', 'IYYY-IW'),
      0, 'NEW-ARRIVAL', 'PLANNED', 'NEW_ARRIVAL'
    ) on conflict do nothing;
  end loop;

  return new;
end;
$function$;
revoke all on function public.facebook_enqueue_new_arrival() from public, anon, authenticated;

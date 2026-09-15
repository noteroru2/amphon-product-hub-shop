-- AMPHON ONE production Hub -> System outbox delivery support.
-- Server-side only. RPCs are SECURITY INVOKER and executable by service_role only.

create or replace function public.oneprod_claim_hub_outbox(
  p_worker_id text,
  p_limit integer default 10,
  p_lock_timeout_seconds integer default 120
)
returns setof public.integration_event_outbox
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_worker_id, '')), '') is null then
    raise exception 'HUB_OUTBOX_WORKER_ID_REQUIRED';
  end if;

  return query
  with candidates as (
    select o.id
    from public.integration_event_outbox o
    where o.destination = 'amphon-system'
      and (
        (o.status in ('PENDING','FAILED') and o.next_attempt_at <= now())
        or (
          o.status = 'SENDING'
          and o.locked_at is not null
          and o.locked_at < now() - make_interval(secs => greatest(30, least(coalesce(p_lock_timeout_seconds, 120), 900)))
        )
      )
    order by o.next_attempt_at asc, o.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.integration_event_outbox o
  set status = 'SENDING',
      attempts = o.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      last_error = null,
      updated_at = now()
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$$;

create or replace function public.oneprod_finish_hub_outbox(
  p_id uuid,
  p_worker_id text,
  p_outcome text,
  p_next_attempt_at timestamptz default null,
  p_last_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.integration_event_outbox%rowtype;
  v_outcome text := upper(btrim(coalesce(p_outcome, '')));
begin
  if v_outcome not in ('DELIVERED','FAILED','DEAD') then
    return jsonb_build_object('ok', false, 'error', 'HUB_OUTBOX_OUTCOME_INVALID');
  end if;

  select * into v_row
  from public.integration_event_outbox
  where id = p_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'HUB_OUTBOX_ROW_NOT_FOUND');
  end if;

  if v_row.status <> 'SENDING' or coalesce(v_row.locked_by, '') <> coalesce(p_worker_id, '') then
    return jsonb_build_object('ok', false, 'error', 'HUB_OUTBOX_LOCK_MISMATCH', 'status', v_row.status);
  end if;

  if v_outcome = 'DELIVERED' then
    update public.integration_event_outbox
    set status = 'DELIVERED',
        sent_at = coalesce(sent_at, now()),
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = now()
    where id = p_id;
  elsif v_outcome = 'FAILED' then
    update public.integration_event_outbox
    set status = 'FAILED',
        next_attempt_at = coalesce(p_next_attempt_at, now() + interval '1 minute'),
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(p_last_error, 'HUB_OUTBOX_DELIVERY_FAILED'), 2000),
        updated_at = now()
    where id = p_id;
  else
    update public.integration_event_outbox
    set status = 'DEAD',
        locked_at = null,
        locked_by = null,
        last_error = left(coalesce(p_last_error, 'HUB_OUTBOX_DELIVERY_DEAD'), 2000),
        updated_at = now()
    where id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'outcome', v_outcome, 'id', p_id);
end;
$$;

revoke all on function public.oneprod_claim_hub_outbox(text, integer, integer) from public;
revoke all on function public.oneprod_claim_hub_outbox(text, integer, integer) from anon, authenticated;
grant execute on function public.oneprod_claim_hub_outbox(text, integer, integer) to service_role;

revoke all on function public.oneprod_finish_hub_outbox(uuid, text, text, timestamptz, text) from public;
revoke all on function public.oneprod_finish_hub_outbox(uuid, text, text, timestamptz, text) from anon, authenticated;
grant execute on function public.oneprod_finish_hub_outbox(uuid, text, text, timestamptz, text) to service_role;

comment on function public.oneprod_claim_hub_outbox(text, integer, integer) is
  'AMPHON ONE server-only claim/lock RPC for Hub -> System durable outbox delivery.';
comment on function public.oneprod_finish_hub_outbox(uuid, text, text, timestamptz, text) is
  'AMPHON ONE server-only lock-owner completion RPC for Hub -> System durable outbox delivery.';

-- AMPHON SHOP auto-publish scheduler.
-- Supabase Cron is the primary server-side minute runner so publication does
-- not depend on an external browser session or Store Worker deployment.
-- The Cloudflare Worker runner remains safe redundancy through SKIP LOCKED.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function private.process_commerce_auto_publish_batch(
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker_id text :=
    'db-cron:'
    || pg_backend_pid()::text
    || ':'
    || extract(epoch from clock_timestamp())::text;
  v_claim record;
  v_claimed integer := 0;
  v_published integer := 0;
  v_failed integer := 0;
begin
  for v_claim in
    select *
      from public.claim_commerce_auto_publish(v_worker_id, p_limit)
  loop
    v_claimed := v_claimed + 1;

    begin
      perform public.execute_commerce_auto_publish(
        v_claim.product_id,
        v_worker_id
      );
      v_published := v_published + 1;
    exception when others then
      v_failed := v_failed + 1;
      perform public.fail_commerce_auto_publish(
        v_claim.product_id,
        v_worker_id,
        left(sqlstate || ':' || sqlerrm, 1500)
      );
    end;
  end loop;

  return jsonb_build_object(
    'claimed', v_claimed,
    'published', v_published,
    'failed', v_failed
  );
end;
$$;

revoke all on function private.process_commerce_auto_publish_batch(integer) from public;
revoke all on function private.process_commerce_auto_publish_batch(integer) from anon;
revoke all on function private.process_commerce_auto_publish_batch(integer) from authenticated;

select cron.schedule(
  'commerce-auto-publish-minute',
  '* * * * *',
  'select private.process_commerce_auto_publish_batch(20);'
);

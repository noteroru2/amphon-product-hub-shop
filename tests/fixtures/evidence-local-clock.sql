-- SYNTHETIC LOCAL FIXTURE ONLY. Never copy to a hosted or Production project.
-- Avoid days of wall-clock waits while testing real SQL retention/expiry guards.
do $$ begin
 if current_setting('amphon.synthetic_fixture',true) is distinct from 'local-only-20261127'
 or to_regnamespace('amphon_synthetic_local_fixture') is null
 then raise exception 'SYNTHETIC_LOCAL_RUNNER_REQUIRED'; end if;
end $$;
create function public.synthetic_retention_clock(p_key text,p_enabled boolean default false,p_expire uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if to_regnamespace('amphon_synthetic_local_fixture') is null then raise exception 'SYNTHETIC_LOCAL_RUNNER_REQUIRED'; end if;
 update evidence_internal.policy set cleanup_enabled=p_enabled where id;
 update evidence_internal.media set written_at=now()-interval '8 days',terminal_at=now()-interval '8 days' where key=p_key;
 if p_expire is not null then update evidence_internal.approvals set expires_at=now()-interval '1 minute' where id=p_expire; end if;
end $$;
revoke all on function public.synthetic_retention_clock(text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.synthetic_retention_clock(text,boolean,uuid) to service_role;

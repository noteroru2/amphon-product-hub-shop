-- Hotfix boolean policy lookup in causal attribution context.
create or replace function private.gsc_causal_attribution_context(
  p_execution_id uuid,
  p_source_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.commerce_gsc_action_executions;
  v_required boolean := true;
  v_earliest timestamptz;
  v_contaminating jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_status text;
  v_reason text;
begin
  select * into e
  from public.commerce_gsc_action_executions
  where id=p_execution_id;

  if e.id is null then
    return jsonb_build_object(
      'status','UNKNOWN','codes',jsonb_build_array('EXECUTION_NOT_FOUND'),
      'reason','Causal attribution could not find the execution.',
      'contaminatingCommitCount',0,'contaminatingCommits','[]'::jsonb
    );
  end if;

  select coalesce(
    (
      select p.causal_audit_required
      from public.commerce_gsc_executor_policy p
      where p.repository=coalesce(e.repository,'noteroru2/amphon.co.th')
      limit 1
    ),
    true
  )
  into v_required;

  if not v_required then
    return jsonb_build_object(
      'status','PASS','codes','[]'::jsonb,
      'reason','Causal audit is disabled by repository policy.',
      'contaminatingCommitCount',0,'contaminatingCommits','[]'::jsonb
    );
  end if;

  select min(a.committed_at)
  into v_earliest
  from public.commerce_gsc_site_change_audit a
  where a.repository=e.repository;

  if v_earliest is null or v_earliest > e.applied_at then
    return jsonb_build_object(
      'status','UNKNOWN',
      'codes',jsonb_build_array('ATTRIBUTION_AUDIT_GAP'),
      'reason','Git change audit does not yet cover the experiment start; causal attribution is not safe.',
      'auditEarliestAt',v_earliest,
      'contaminatingCommitCount',0,'contaminatingCommits','[]'::jsonb
    );
  end if;

  with candidates as (
    select
      a.commit_sha,a.committed_at,a.changed_files,a.commit_message,
      array(
        select f
        from unnest(a.changed_files) f
        where
          f like 'src/%'
          or f like 'public/%'
          or f in ('package.json','package-lock.json')
          or f like 'astro.config.%'
          or f like 'tsconfig%'
      ) as production_files
    from public.commerce_gsc_site_change_audit a
    where a.repository=e.repository
      and a.committed_at > e.applied_at
      and a.committed_at <= coalesce(p_source_fetched_at,now())
      and not exists (
        select 1
        from public.commerce_gsc_action_executions x
        where x.repository=e.repository
          and (
            x.commit_sha=a.commit_sha
            or x.rollback_actual_commit_sha=a.commit_sha
          )
      )
  ),
  contaminated as (
    select *
    from candidates
    where cardinality(production_files)>0
  )
  select
    count(*)::int,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sha',commit_sha,
          'committedAt',committed_at,
          'files',to_jsonb(production_files),
          'message',commit_message
        )
        order by committed_at
      ),
      '[]'::jsonb
    )
  into v_count,v_contaminating
  from contaminated;

  if v_count>0 then
    v_status := 'CONTAMINATED';
    v_reason := 'Causal Attribution Guard found '||v_count||
      ' unrecognized production-code commit(s) after the experiment started and before the GSC source snapshot.';
  else
    v_status := 'PASS';
    v_reason := 'Causal Attribution PASS: Git audit covers the experiment window and no unrecognized production-code change overlaps it.';
  end if;

  return jsonb_build_object(
    'status',v_status,
    'codes',case when v_status='PASS' then '[]'::jsonb else jsonb_build_array('CAUSAL_CONTAMINATION') end,
    'reason',v_reason,
    'auditEarliestAt',v_earliest,
    'contaminatingCommitCount',v_count,
    'contaminatingCommits',v_contaminating
  );
end;
$$;

revoke all on function private.gsc_causal_attribution_context(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.gsc_causal_attribution_context(uuid,timestamptz) to service_role;

-- Fix rollback claim CTE scope: persist a per-call lease token and update execution state by that token.

create or replace function public.claim_gsc_rollback_jobs(
  p_repository text,
  p_limit integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  v_claim_token uuid := gen_random_uuid();
begin
  with picked as (
    select r.id
    from public.commerce_gsc_rollback_jobs r
    where r.repository=p_repository
      and (
        r.status in ('QUEUED','VERIFYING')
        or (r.status='FAILED' and r.attempts < 3)
      )
      and (r.lease_expires_at is null or r.lease_expires_at < now())
    order by
      case r.status when 'VERIFYING' then 0 when 'QUEUED' then 1 else 2 end,
      r.updated_at,
      r.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ),
  claimed as (
    update public.commerce_gsc_rollback_jobs r
    set
      status='RUNNING',
      attempts=r.attempts+1,
      lease_token=v_claim_token,
      lease_expires_at=now()+interval '20 minutes',
      last_error=null,
      updated_at=now()
    from picked p
    where r.id=p.id
    returning r.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',r.id,
    'executionId',r.execution_id,
    'actionId',r.action_id,
    'triggerMeasurementId',r.trigger_measurement_id,
    'repository',r.repository,
    'status',r.status,
    'reason',r.reason,
    'attempts',r.attempts,
    'originalCommitSha',r.original_commit_sha,
    'rollbackPointSha',r.rollback_point_sha,
    'changedFiles',to_jsonb(r.changed_files),
    'patchPayload',r.patch_payload,
    'revertCommitSha',r.revert_commit_sha,
    'revertDiffText',r.revert_diff_text,
    'revertDiffSha256',r.revert_diff_sha256,
    'action',jsonb_build_object(
      'id',a.id,
      'page',a.page,
      'actionType',a.action_type,
      'primaryQuery',a.primary_query
    ),
    'execution',jsonb_build_object(
      'executionKind',e.execution_kind,
      'riskMode',e.risk_mode,
      'appliedAt',e.applied_at,
      'pullRequestNumber',e.pull_request_number
    ),
    'measurement',jsonb_build_object(
      'checkpointDays',m.checkpoint_days,
      'verdict',m.verdict,
      'rollbackRecommended',m.rollback_recommended,
      'clicksDelta',m.clicks_delta,
      'impressionsDelta',m.impressions_delta,
      'ctrDelta',m.ctr_delta,
      'positionDelta',m.position_delta,
      'measuredAt',m.measured_at
    )
  ) order by r.updated_at),'[]'::jsonb)
  into result
  from claimed r
  join public.commerce_gsc_action_executions e on e.id=r.execution_id
  join public.commerce_gsc_action_queue a on a.id=r.action_id
  join public.commerce_gsc_action_measurements m on m.id=r.trigger_measurement_id;

  update public.commerce_gsc_action_executions e
  set rollback_status='RUNNING',rollback_error=null
  where exists (
    select 1
    from public.commerce_gsc_rollback_jobs r
    where r.execution_id=e.id
      and r.lease_token=v_claim_token
      and r.status='RUNNING'
  );

  return result;
end;
$$;

revoke all on function public.claim_gsc_rollback_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_gsc_rollback_jobs(text,integer) to service_role;

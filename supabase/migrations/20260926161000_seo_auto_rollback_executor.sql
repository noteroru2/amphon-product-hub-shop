-- SEO Auto Rollback Executor
-- Automatically reverts the exact deployed SEO commit when a measured checkpoint is REGRESSED.
-- Safety: never reset main; always create an inverse Git commit. Conflicts/missing evidence block for human review.

alter table public.commerce_gsc_action_executions
  add column if not exists rollback_status text not null default 'NONE'
    check (rollback_status in ('NONE','QUEUED','RUNNING','VERIFYING','ROLLED_BACK','BLOCKED','FAILED')),
  add column if not exists rollback_trigger_measurement_id uuid references public.commerce_gsc_action_measurements(id) on delete set null,
  add column if not exists rollback_actual_commit_sha text,
  add column if not exists rollback_actual_diff_sha256 text,
  add column if not exists rolled_back_at timestamptz,
  add column if not exists rollback_error text;

create table if not exists public.commerce_gsc_rollback_jobs (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique references public.commerce_gsc_action_executions(id) on delete cascade,
  action_id uuid not null references public.commerce_gsc_action_queue(id) on delete cascade,
  trigger_measurement_id uuid not null references public.commerce_gsc_action_measurements(id) on delete cascade,
  repository text not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED','RUNNING','VERIFYING','ROLLED_BACK','BLOCKED','FAILED','CANCELLED')),
  reason text not null,
  attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  original_commit_sha text,
  rollback_point_sha text,
  changed_files text[] not null default '{}'::text[],
  patch_payload jsonb not null default '{}'::jsonb,
  revert_commit_sha text,
  revert_diff_text text,
  revert_diff_sha256 text,
  live_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_gsc_rollback_jobs_claim_idx
  on public.commerce_gsc_rollback_jobs(repository,status,updated_at);
create index if not exists commerce_gsc_rollback_jobs_action_idx
  on public.commerce_gsc_rollback_jobs(action_id,created_at desc);

alter table public.commerce_gsc_rollback_jobs enable row level security;
drop policy if exists commerce_gsc_rollback_jobs_read_admin on public.commerce_gsc_rollback_jobs;
create policy commerce_gsc_rollback_jobs_read_admin
on public.commerce_gsc_rollback_jobs
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_rollback_jobs from anon;
revoke insert,update,delete on public.commerce_gsc_rollback_jobs from authenticated;
grant select on public.commerce_gsc_rollback_jobs to authenticated;
grant select,insert,update,delete on public.commerce_gsc_rollback_jobs to service_role;

create or replace function private.enqueue_gsc_rollback_for_measurement(p_measurement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.commerce_gsc_action_measurements;
  e public.commerce_gsc_action_executions;
  a public.commerce_gsc_action_queue;
  j public.commerce_gsc_executor_jobs;
  v_status text;
  v_reason text;
begin
  select * into m
  from public.commerce_gsc_action_measurements
  where id=p_measurement_id;

  if m.id is null or m.verdict <> 'REGRESSED' or not m.rollback_recommended then
    return;
  end if;

  select * into e
  from public.commerce_gsc_action_executions
  where id=m.execution_id;

  if e.id is null then return; end if;

  select * into a
  from public.commerce_gsc_action_queue
  where id=e.action_id;

  if e.executor_job_id is not null then
    select * into j
    from public.commerce_gsc_executor_jobs
    where id=e.executor_job_id;
  end if;

  if e.monitor_status='STOPPED' or e.rollback_status='ROLLED_BACK' then
    return;
  end if;

  if e.repository='noteroru2/amphon.co.th'
     and e.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
     and e.commit_sha is not null
     and e.rollback_commit_sha is not null
     and cardinality(e.changed_files) > 0
     and j.id is not null
     and j.patch_payload <> '{}'::jsonb
  then
    v_status := 'QUEUED';
    v_reason := 'Automatic rollback queued because GSC checkpoint '||m.checkpoint_days||
      'd is REGRESSED and rollback_recommended=true. Revert the exact deployed commit; never reset main.';
  else
    v_status := 'BLOCKED';
    v_reason := 'REGRESSED requires rollback, but automatic rollback evidence/target is incomplete. Human review required.';
  end if;

  insert into public.commerce_gsc_rollback_jobs(
    execution_id,action_id,trigger_measurement_id,repository,status,reason,
    original_commit_sha,rollback_point_sha,changed_files,patch_payload,updated_at
  )
  values (
    e.id,e.action_id,m.id,coalesce(e.repository,'UNSUPPORTED'),v_status,v_reason,
    e.commit_sha,e.rollback_commit_sha,coalesce(e.changed_files,'{}'::text[]),
    coalesce(j.patch_payload,'{}'::jsonb),now()
  )
  on conflict (execution_id) do update set
    trigger_measurement_id=excluded.trigger_measurement_id,
    reason=case
      when public.commerce_gsc_rollback_jobs.status='ROLLED_BACK' then public.commerce_gsc_rollback_jobs.reason
      else excluded.reason
    end,
    status=case
      when public.commerce_gsc_rollback_jobs.status in ('RUNNING','VERIFYING','ROLLED_BACK') then public.commerce_gsc_rollback_jobs.status
      else excluded.status
    end,
    updated_at=now();

  update public.commerce_gsc_action_executions
  set
    rollback_status=case
      when rollback_status='ROLLED_BACK' then rollback_status
      when v_status='QUEUED' then 'QUEUED'
      else 'BLOCKED'
    end,
    rollback_trigger_measurement_id=m.id,
    rollback_error=case when v_status='BLOCKED' then v_reason else null end
  where id=e.id;
end;
$$;

revoke all on function private.enqueue_gsc_rollback_for_measurement(uuid) from public,anon,authenticated;
grant execute on function private.enqueue_gsc_rollback_for_measurement(uuid) to service_role;

create or replace function private.refresh_gsc_rollback_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select m.id
    from public.commerce_gsc_action_measurements m
    join public.commerce_gsc_action_executions e on e.id=m.execution_id
    where m.verdict='REGRESSED'
      and m.rollback_recommended
      and e.monitor_status <> 'STOPPED'
      and e.rollback_status <> 'ROLLED_BACK'
  loop
    perform private.enqueue_gsc_rollback_for_measurement(r.id);
  end loop;
end;
$$;

revoke all on function private.refresh_gsc_rollback_jobs() from public,anon,authenticated;
grant execute on function private.refresh_gsc_rollback_jobs() to service_role;

create or replace function private.gsc_rollback_measurement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.verdict='REGRESSED' and new.rollback_recommended then
    perform private.enqueue_gsc_rollback_for_measurement(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists commerce_gsc_measurement_auto_rollback on public.commerce_gsc_action_measurements;
create trigger commerce_gsc_measurement_auto_rollback
after insert or update of verdict,rollback_recommended
on public.commerce_gsc_action_measurements
for each row
execute function private.gsc_rollback_measurement_trigger();

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
      lease_token=gen_random_uuid(),
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
    select 1 from claimed r where r.execution_id=e.id
  );

  return result;
end;
$$;

revoke all on function public.claim_gsc_rollback_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_gsc_rollback_jobs(text,integer) to service_role;

create or replace function public.finish_gsc_rollback_job(
  p_job_id uuid,
  p_outcome text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.commerce_gsc_rollback_jobs;
  e public.commerce_gsc_action_executions;
  m public.commerce_gsc_action_measurements;
  v_revert_sha text;
  v_diff text;
  v_diff_sha text;
  v_live timestamptz;
  v_error text;
begin
  if p_outcome not in ('VERIFYING','ROLLED_BACK','BLOCKED','FAILED') then
    raise exception 'INVALID_ROLLBACK_OUTCOME';
  end if;

  select * into r
  from public.commerce_gsc_rollback_jobs
  where id=p_job_id
  for update;

  if r.id is null then raise exception 'GSC_ROLLBACK_JOB_NOT_FOUND'; end if;

  select * into e
  from public.commerce_gsc_action_executions
  where id=r.execution_id;

  select * into m
  from public.commerce_gsc_action_measurements
  where id=r.trigger_measurement_id;

  v_revert_sha := coalesce(nullif(p_payload->>'revertCommitSha',''),r.revert_commit_sha);
  v_diff := coalesce(p_payload->>'revertDiffText',r.revert_diff_text);
  v_diff_sha := coalesce(nullif(p_payload->>'revertDiffSha256',''),r.revert_diff_sha256);
  v_error := nullif(p_payload->>'error','');
  v_live := case
    when nullif(p_payload->>'liveVerifiedAt','') is null then r.live_verified_at
    else (p_payload->>'liveVerifiedAt')::timestamptz
  end;

  if p_outcome in ('VERIFYING','ROLLED_BACK') then
    if v_revert_sha is null or v_diff is null or length(v_diff)=0 or v_diff_sha is null then
      raise exception 'ROLLBACK_GIT_EVIDENCE_REQUIRED';
    end if;
  end if;

  if p_outcome='ROLLED_BACK' and v_live is null then
    raise exception 'ROLLBACK_LIVE_VERIFICATION_REQUIRED';
  end if;

  update public.commerce_gsc_rollback_jobs
  set
    status=p_outcome,
    revert_commit_sha=v_revert_sha,
    revert_diff_text=v_diff,
    revert_diff_sha256=v_diff_sha,
    live_verified_at=v_live,
    last_error=case when p_outcome in ('FAILED','BLOCKED') then coalesce(v_error,'Rollback stopped without an error message') else null end,
    lease_token=null,
    lease_expires_at=null,
    updated_at=now()
  where id=p_job_id
  returning * into r;

  update public.commerce_gsc_action_executions
  set
    rollback_status=p_outcome,
    rollback_actual_commit_sha=v_revert_sha,
    rollback_actual_diff_sha256=v_diff_sha,
    rolled_back_at=case when p_outcome='ROLLED_BACK' then now() else rolled_back_at end,
    rollback_error=case when p_outcome in ('FAILED','BLOCKED') then coalesce(v_error,r.last_error) else null end,
    monitor_status=case when p_outcome='ROLLED_BACK' then 'STOPPED' else monitor_status end,
    rollback_review_reason=case
      when p_outcome='ROLLED_BACK' then
        'AUTO ROLLBACK completed after GSC checkpoint '||coalesce(m.checkpoint_days,0)||
        'd REGRESSED. Revert commit: '||coalesce(v_revert_sha,'unknown')
      when p_outcome='BLOCKED' then
        'AUTO ROLLBACK blocked: '||coalesce(v_error,r.last_error,'human review required')
      else rollback_review_reason
    end
  where id=r.execution_id;

  if p_outcome='ROLLED_BACK' then
    update public.commerce_gsc_action_queue
    set
      owner_note=concat_ws(E'\n',owner_note,
        'Auto rollback executed after '||coalesce(m.checkpoint_days,0)||'d REGRESSED measurement. Revert commit '||v_revert_sha),
      updated_at=now()
    where id=r.action_id;
  end if;

  return to_jsonb(r);
end;
$$;

revoke all on function public.finish_gsc_rollback_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_gsc_rollback_job(uuid,text,jsonb) to service_role;

select private.refresh_gsc_rollback_jobs();

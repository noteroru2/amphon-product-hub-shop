-- SEO Action Executor — risk-gated execution, Git evidence, PR-only meta patches
-- 2026-09-26

create table if not exists public.commerce_gsc_executor_jobs (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.commerce_gsc_action_queue(id) on delete cascade,
  risk_mode text not null check (risk_mode in ('AUTO_DEPLOY','PR_ONLY','HUMAN_REVIEW','PROTECT','OBSERVE')),
  status text not null check (status in ('QUEUED','RUNNING','VERIFYING','PR_READY','APPLIED','BLOCKED','PROTECTED','FAILED','CANCELLED')),
  target_repository text not null,
  base_branch text not null default 'main',
  execution_kind text not null check (execution_kind in ('INTERNAL_LINK','META','RECOVERY','OTHER')),
  reason text not null,
  attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  base_commit_sha text,
  patch_commit_sha text,
  rollback_commit_sha text,
  diff_text text,
  diff_sha256 text,
  changed_files text[] not null default '{}'::text[],
  patch_payload jsonb not null default '{}'::jsonb,
  pull_request_number integer,
  pull_request_url text,
  pr_merged_at timestamptz,
  live_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_gsc_executor_jobs_status_idx
  on public.commerce_gsc_executor_jobs(target_repository,status,updated_at);
create index if not exists commerce_gsc_executor_jobs_action_idx
  on public.commerce_gsc_executor_jobs(action_id);

alter table public.commerce_gsc_executor_jobs enable row level security;
drop policy if exists commerce_gsc_executor_jobs_read_admin on public.commerce_gsc_executor_jobs;
create policy commerce_gsc_executor_jobs_read_admin
on public.commerce_gsc_executor_jobs
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_executor_jobs from anon;
revoke insert,update,delete on public.commerce_gsc_executor_jobs from authenticated;
grant select on public.commerce_gsc_executor_jobs to authenticated;
grant select,insert,update,delete on public.commerce_gsc_executor_jobs to service_role;

alter table public.commerce_gsc_action_executions
  add column if not exists executor_job_id uuid references public.commerce_gsc_executor_jobs(id) on delete set null,
  add column if not exists base_commit_sha text,
  add column if not exists rollback_commit_sha text,
  add column if not exists diff_text text,
  add column if not exists diff_sha256 text,
  add column if not exists changed_files text[] not null default '{}'::text[],
  add column if not exists risk_mode text;

create unique index if not exists commerce_gsc_action_executions_executor_job_uidx
  on public.commerce_gsc_action_executions(executor_job_id)
  where executor_job_id is not null;

create or replace function private.refresh_gsc_executor_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with eligible as (
    select
      q.id as action_id,
      q.page,
      q.action_type,
      q.status as action_status,
      q.candidate_title,
      q.candidate_description,
      d.competing_page_count,
      d.auto_safe_internal_link,
      d.requires_human_review,
      case
        when q.page like 'https://amphon.co.th/%' then 'noteroru2/amphon.co.th'
        when q.page like 'https://shop.amphon.co.th/%' then 'noteroru2/amphon-product-hub-shop'
        else 'UNSUPPORTED'
      end as target_repository
    from public.commerce_gsc_action_queue q
    left join public.commerce_gsc_recovery_diagnostics d on d.action_id=q.id
    where q.status in ('APPROVED','PROTECTED')
  ),
  classified as (
    select
      e.*,
      case
        when e.action_type='PROTECT_PAGE' then 'PROTECT'
        when e.target_repository <> 'noteroru2/amphon.co.th' then 'HUMAN_REVIEW'
        when e.action_type='INTERNAL_LINK_BOOST'
          and coalesce(e.auto_safe_internal_link,false)
          and not coalesce(e.requires_human_review,true)
          then 'AUTO_DEPLOY'
        when e.action_type='META_REVIEW'
          and (nullif(btrim(coalesce(e.candidate_title,'')),'') is not null
            or nullif(btrim(coalesce(e.candidate_description,'')),'') is not null)
          and (
            e.page like 'https://amphon.co.th/%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%81%E0%B8%B2%E0%B8%A3/%'
            or e.page like 'https://amphon.co.th/blog/%'
          )
          then 'PR_ONLY'
        when e.action_type='RECOVERY_PLAN' then 'HUMAN_REVIEW'
        when e.action_type in ('BRAND_WATCH','WATCH') then 'OBSERVE'
        else 'HUMAN_REVIEW'
      end as risk_mode,
      case
        when e.action_type='INTERNAL_LINK_BOOST' then 'INTERNAL_LINK'
        when e.action_type='META_REVIEW' then 'META'
        when e.action_type='RECOVERY_PLAN' then 'RECOVERY'
        else 'OTHER'
      end as execution_kind
    from eligible e
  ),
  prepared as (
    select
      c.*,
      case
        when c.risk_mode='PROTECT' then 'PROTECTED'
        when c.risk_mode in ('HUMAN_REVIEW','OBSERVE') then 'BLOCKED'
        else 'QUEUED'
      end as desired_status,
      case
        when c.risk_mode='AUTO_DEPLOY' then
          'Approved INTERNAL_LINK_BOOST passed Auto-link guard: one owner page, no human-review flag. Executor may commit only the guarded link registry, then verify live HTML.'
        when c.risk_mode='PR_ONLY' then
          'Approved META_REVIEW: executor may create a branch and pull request that changes only title/description frontmatter. No direct deploy.'
        when c.risk_mode='PROTECT' then
          'PROTECT_PAGE: mutation forbidden. Title, H1, URL and canonical remain locked.'
        when c.action_type='RECOVERY_PLAN' and coalesce(c.competing_page_count,0) >= 2 then
          'RECOVERY_PLAN has competing Query×Page ownership/cannibalization evidence. Human review required before any patch.'
        when c.action_type='RECOVERY_PLAN' then
          'RECOVERY_PLAN is intentionally human-reviewed before any code patch.'
        when c.target_repository <> 'noteroru2/amphon.co.th' then
          'Automatic executor is not enabled for this target repository yet; keep as human review.'
        else
          'Action did not satisfy an automatic execution guard. Human review required.'
      end as reason
    from classified c
  )
  insert into public.commerce_gsc_executor_jobs(
    action_id,risk_mode,status,target_repository,base_branch,execution_kind,reason,updated_at
  )
  select
    p.action_id,p.risk_mode,p.desired_status,p.target_repository,'main',p.execution_kind,p.reason,now()
  from prepared p
  on conflict (action_id) do update set
    risk_mode=excluded.risk_mode,
    target_repository=excluded.target_repository,
    base_branch=excluded.base_branch,
    execution_kind=excluded.execution_kind,
    reason=excluded.reason,
    status=case
      when public.commerce_gsc_executor_jobs.status in ('RUNNING','VERIFYING','PR_READY','APPLIED','FAILED') then public.commerce_gsc_executor_jobs.status
      else excluded.status
    end,
    updated_at=now();

  update public.commerce_gsc_executor_jobs j
  set status='CANCELLED', lease_token=null, lease_expires_at=null, updated_at=now()
  where j.status not in ('APPLIED','CANCELLED')
    and not exists (
      select 1
      from public.commerce_gsc_action_queue q
      where q.id=j.action_id
        and q.status in ('APPROVED','PROTECTED')
    );
end;
$$;

revoke all on function private.refresh_gsc_executor_jobs() from public,anon,authenticated;
grant execute on function private.refresh_gsc_executor_jobs() to service_role;

create or replace function public.claim_gsc_executor_jobs(
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
    select j.id
    from public.commerce_gsc_executor_jobs j
    where j.target_repository=p_repository
      and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
      and j.status in ('QUEUED','VERIFYING')
      and (j.lease_expires_at is null or j.lease_expires_at < now())
    order by
      case j.status when 'VERIFYING' then 0 else 1 end,
      j.updated_at,
      j.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ),
  claimed as (
    update public.commerce_gsc_executor_jobs j
    set
      status='RUNNING',
      attempts=j.attempts+1,
      lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '20 minutes',
      updated_at=now()
    from picked p
    where j.id=p.id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',j.id,
    'riskMode',j.risk_mode,
    'status',j.status,
    'targetRepository',j.target_repository,
    'baseBranch',j.base_branch,
    'executionKind',j.execution_kind,
    'reason',j.reason,
    'attempts',j.attempts,
    'baseCommitSha',j.base_commit_sha,
    'patchCommitSha',j.patch_commit_sha,
    'rollbackCommitSha',j.rollback_commit_sha,
    'diffText',j.diff_text,
    'diffSha256',j.diff_sha256,
    'changedFiles',to_jsonb(j.changed_files),
    'patchPayload',j.patch_payload,
    'pullRequestNumber',j.pull_request_number,
    'pullRequestUrl',j.pull_request_url,
    'action',jsonb_build_object(
      'id',a.id,
      'page',a.page,
      'actionType',a.action_type,
      'status',a.status,
      'primaryQuery',a.primary_query,
      'candidateTitle',a.candidate_title,
      'candidateDescription',a.candidate_description,
      'candidateNotes',a.candidate_notes,
      'clicks',a.clicks,
      'impressions',a.impressions,
      'ctr',a.ctr,
      'position',a.position,
      'approvedAt',a.updated_at
    ),
    'diagnostic',jsonb_build_object(
      'diagnosisType',d.diagnosis_type,
      'competingPageCount',coalesce(d.competing_page_count,0),
      'autoSafeInternalLink',coalesce(d.auto_safe_internal_link,false),
      'requiresHumanReview',coalesce(d.requires_human_review,true)
    )
  ) order by j.updated_at),'[]'::jsonb)
  into result
  from claimed j
  join public.commerce_gsc_action_queue a on a.id=j.action_id
  left join public.commerce_gsc_recovery_diagnostics d on d.action_id=a.id;

  return result;
end;
$$;

revoke all on function public.claim_gsc_executor_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_gsc_executor_jobs(text,integer) to service_role;

create or replace function public.list_gsc_executor_pr_ready(
  p_repository text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'jobId',j.id,
  'riskMode',j.risk_mode,
  'status',j.status,
  'targetRepository',j.target_repository,
  'baseBranch',j.base_branch,
  'executionKind',j.execution_kind,
  'reason',j.reason,
  'attempts',j.attempts,
  'baseCommitSha',j.base_commit_sha,
  'patchCommitSha',j.patch_commit_sha,
  'rollbackCommitSha',j.rollback_commit_sha,
  'diffText',j.diff_text,
  'diffSha256',j.diff_sha256,
  'changedFiles',to_jsonb(j.changed_files),
  'patchPayload',j.patch_payload,
  'pullRequestNumber',j.pull_request_number,
  'pullRequestUrl',j.pull_request_url,
  'action',jsonb_build_object(
    'id',a.id,
    'page',a.page,
    'actionType',a.action_type,
    'status',a.status,
    'primaryQuery',a.primary_query,
    'candidateTitle',a.candidate_title,
    'candidateDescription',a.candidate_description,
    'candidateNotes',a.candidate_notes,
    'clicks',a.clicks,
    'impressions',a.impressions,
    'ctr',a.ctr,
    'position',a.position,
    'approvedAt',a.updated_at
  )
) order by j.updated_at),'[]'::jsonb)
from public.commerce_gsc_executor_jobs j
join public.commerce_gsc_action_queue a on a.id=j.action_id
where j.target_repository=p_repository
  and j.status='PR_READY';
$$;

revoke all on function public.list_gsc_executor_pr_ready(text) from public,anon,authenticated;
grant execute on function public.list_gsc_executor_pr_ready(text) to service_role;

create or replace function public.finish_gsc_executor_job(
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
  j public.commerce_gsc_executor_jobs;
  a public.commerce_gsc_action_queue;
  v_changed_files text[];
  v_base text;
  v_commit text;
  v_rollback text;
  v_diff text;
  v_diff_sha text;
  v_pr integer;
  v_pr_url text;
  v_live timestamptz;
  v_pr_merged timestamptz;
  v_error text;
  v_patch jsonb;
  v_fetched timestamptz;
  v_execution_id uuid;
begin
  if p_outcome not in ('VERIFYING','PR_READY','APPLIED','BLOCKED','FAILED') then
    raise exception 'INVALID_EXECUTOR_OUTCOME';
  end if;

  select * into j
  from public.commerce_gsc_executor_jobs
  where id=p_job_id
  for update;

  if j.id is null then
    raise exception 'GSC_EXECUTOR_JOB_NOT_FOUND';
  end if;

  select * into a
  from public.commerce_gsc_action_queue
  where id=j.action_id;

  if a.id is null then
    raise exception 'GSC_ACTION_NOT_FOUND';
  end if;

  if jsonb_typeof(p_payload->'changedFiles')='array' then
    select coalesce(array_agg(value),'{}'::text[]) into v_changed_files
    from jsonb_array_elements_text(p_payload->'changedFiles');
  else
    v_changed_files := j.changed_files;
  end if;

  v_base := coalesce(nullif(p_payload->>'baseCommitSha',''),j.base_commit_sha);
  v_commit := coalesce(nullif(p_payload->>'patchCommitSha',''),j.patch_commit_sha);
  v_rollback := coalesce(nullif(p_payload->>'rollbackCommitSha',''),j.rollback_commit_sha,v_base);
  v_diff := coalesce(p_payload->>'diffText',j.diff_text);
  v_diff_sha := coalesce(nullif(p_payload->>'diffSha256',''),j.diff_sha256);
  v_pr := coalesce(nullif(p_payload->>'pullRequestNumber','')::integer,j.pull_request_number);
  v_pr_url := coalesce(nullif(p_payload->>'pullRequestUrl',''),j.pull_request_url);
  v_error := nullif(p_payload->>'error','');
  v_patch := coalesce(p_payload->'patchPayload',j.patch_payload,'{}'::jsonb);
  v_live := case when nullif(p_payload->>'liveVerifiedAt','') is null then j.live_verified_at else (p_payload->>'liveVerifiedAt')::timestamptz end;
  v_pr_merged := case when nullif(p_payload->>'prMergedAt','') is null then j.pr_merged_at else (p_payload->>'prMergedAt')::timestamptz end;

  if p_outcome in ('VERIFYING','PR_READY','APPLIED') then
    if v_base is null or v_commit is null or v_diff is null or length(v_diff)=0 then
      raise exception 'EXECUTOR_GIT_EVIDENCE_REQUIRED';
    end if;
  end if;

  if p_outcome='PR_READY' and (v_pr is null or v_pr_url is null) then
    raise exception 'EXECUTOR_PR_EVIDENCE_REQUIRED';
  end if;

  if p_outcome='APPLIED' and j.risk_mode not in ('AUTO_DEPLOY','PR_ONLY') then
    raise exception 'EXECUTOR_RISK_MODE_BLOCKS_APPLY';
  end if;

  update public.commerce_gsc_executor_jobs
  set
    status=p_outcome,
    base_commit_sha=v_base,
    patch_commit_sha=v_commit,
    rollback_commit_sha=v_rollback,
    diff_text=v_diff,
    diff_sha256=v_diff_sha,
    changed_files=coalesce(v_changed_files,'{}'::text[]),
    patch_payload=v_patch,
    pull_request_number=v_pr,
    pull_request_url=v_pr_url,
    pr_merged_at=v_pr_merged,
    live_verified_at=v_live,
    last_error=case when p_outcome='FAILED' then coalesce(v_error,'Executor failed without an error message') else null end,
    lease_token=null,
    lease_expires_at=null,
    updated_at=now()
  where id=p_job_id
  returning * into j;

  if p_outcome='APPLIED' then
    if j.live_verified_at is null then
      raise exception 'EXECUTOR_LIVE_VERIFICATION_REQUIRED';
    end if;

    select max(d.fetched_at) into v_fetched
    from public.commerce_gsc_query_demand d
    where d.property=a.property
      and d.page=a.page
      and d.window_days=28;

    insert into public.commerce_gsc_action_executions(
      action_id,execution_kind,repository,pull_request_number,commit_sha,live_url,
      applied_at,baseline_clicks,baseline_impressions,baseline_ctr,baseline_position,
      baseline_fetched_at,notes,executor_job_id,base_commit_sha,rollback_commit_sha,
      diff_text,diff_sha256,changed_files,risk_mode
    )
    values (
      a.id,j.execution_kind,j.target_repository,j.pull_request_number,j.patch_commit_sha,a.page,
      now(),a.clicks,a.impressions,a.ctr,a.position,
      v_fetched,'SEO Action Executor: live-verified guarded change.',j.id,j.base_commit_sha,j.rollback_commit_sha,
      j.diff_text,j.diff_sha256,j.changed_files,j.risk_mode
    )
    on conflict (executor_job_id) where executor_job_id is not null
    do update set
      pull_request_number=excluded.pull_request_number,
      commit_sha=excluded.commit_sha,
      live_url=excluded.live_url,
      applied_at=excluded.applied_at,
      base_commit_sha=excluded.base_commit_sha,
      rollback_commit_sha=excluded.rollback_commit_sha,
      diff_text=excluded.diff_text,
      diff_sha256=excluded.diff_sha256,
      changed_files=excluded.changed_files,
      risk_mode=excluded.risk_mode
    returning id into v_execution_id;

    update public.commerce_gsc_action_queue
    set status='APPLIED',resolved_at=now(),updated_at=now()
    where id=a.id;
  end if;

  return to_jsonb(j);
end;
$$;

revoke all on function public.finish_gsc_executor_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_gsc_executor_job(uuid,text,jsonb) to service_role;

create or replace function public.retry_gsc_executor_job(p_job_id uuid)
returns public.commerce_gsc_executor_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.commerce_gsc_executor_jobs;
begin
  if public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into j
  from public.commerce_gsc_executor_jobs
  where id=p_job_id
  for update;

  if j.id is null then
    raise exception 'GSC_EXECUTOR_JOB_NOT_FOUND';
  end if;
  if j.risk_mode not in ('AUTO_DEPLOY','PR_ONLY') then
    raise exception 'EXECUTOR_RETRY_NOT_ALLOWED_FOR_RISK_MODE';
  end if;
  if j.status not in ('FAILED','BLOCKED') then
    raise exception 'EXECUTOR_RETRY_NOT_ALLOWED_FOR_STATUS';
  end if;

  update public.commerce_gsc_executor_jobs
  set status='QUEUED',last_error=null,lease_token=null,lease_expires_at=null,updated_at=now()
  where id=p_job_id
  returning * into j;

  return j;
end;
$$;

revoke all on function public.retry_gsc_executor_job(uuid) from public,anon;
grant execute on function public.retry_gsc_executor_job(uuid) to authenticated,service_role;

create or replace function public.set_gsc_action_status(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns public.commerce_gsc_action_queue
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row public.commerce_gsc_action_queue;
begin
  if public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_status not in ('OPEN','APPROVED','APPLIED','DISMISSED','PROTECTED') then
    raise exception 'INVALID_GSC_ACTION_STATUS';
  end if;

  update public.commerce_gsc_action_queue
  set
    status=p_status,
    owner_note=coalesce(p_note, owner_note),
    resolved_at=case when p_status in ('APPLIED','DISMISSED') then now() else null end,
    updated_at=now()
  where id=p_id
  returning * into result_row;

  if result_row.id is null then
    raise exception 'GSC_ACTION_NOT_FOUND';
  end if;

  perform private.refresh_gsc_executor_jobs();
  return result_row;
end;
$$;

revoke all on function public.set_gsc_action_status(uuid,text,text) from public;
revoke all on function public.set_gsc_action_status(uuid,text,text) from anon;
grant execute on function public.set_gsc_action_status(uuid,text,text) to authenticated;
grant execute on function public.set_gsc_action_status(uuid,text,text) to service_role;

select private.refresh_gsc_executor_jobs();

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname='commerce-seo-governance-15m'
  limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end $$;

select cron.schedule(
  'commerce-seo-governance-15m',
  '*/15 * * * *',
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements();'
);

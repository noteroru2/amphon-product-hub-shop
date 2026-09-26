-- Prior-aware Action Selector
-- Uses only mature, integrity-derived Learning Ledger evidence.
-- Positive priors may change ordering only; they never bypass hard safety guards.
-- Negative priors can downgrade an otherwise automatic mutation to Human Review.

alter table public.commerce_gsc_executor_policy
  add column if not exists prior_min_high_confidence_experiments integer not null default 3
    check (prior_min_high_confidence_experiments between 2 and 20),
  add column if not exists prior_favor_score numeric not null default 0.35
    check (prior_favor_score between 0.10 and 1),
  add column if not exists prior_caution_score numeric not null default -0.35
    check (prior_caution_score between -1 and -0.10),
  add column if not exists prior_min_directional_evidence integer not null default 2
    check (prior_min_directional_evidence between 1 and 20),
  add column if not exists prior_favor_priority_multiplier numeric not null default 1.15
    check (prior_favor_priority_multiplier between 1 and 2);

update public.commerce_gsc_executor_policy
set
  prior_min_high_confidence_experiments=3,
  prior_favor_score=0.35,
  prior_caution_score=-0.35,
  prior_min_directional_evidence=2,
  prior_favor_priority_multiplier=1.15,
  updated_at=now()
where repository='noteroru2/amphon.co.th';

alter table public.commerce_gsc_executor_jobs
  add column if not exists prior_state text not null default 'COLD_START'
    check (prior_state in ('COLD_START','FAVOR','NEUTRAL','CAUTION')),
  add column if not exists prior_scope text not null default 'NONE'
    check (prior_scope in ('NONE','EXACT','ACTION_TYPE','EXACT_COLD_START','ACTION_TYPE_COLD_START')),
  add column if not exists prior_score numeric not null default 0,
  add column if not exists prior_experiments integer not null default 0,
  add column if not exists prior_high_confidence_experiments integer not null default 0,
  add column if not exists prior_benefit_confirmed integer not null default 0,
  add column if not exists prior_harm_directional integer not null default 0,
  add column if not exists prior_adjusted_priority numeric not null default 0,
  add column if not exists prior_reason text,
  add column if not exists prior_checked_at timestamptz;

alter table public.commerce_gsc_learning_ledger
  add column if not exists selector_prior_state text,
  add column if not exists selector_prior_scope text,
  add column if not exists selector_prior_score numeric,
  add column if not exists selector_prior_high_confidence_experiments integer,
  add column if not exists selector_prior_checked_at timestamptz;

-- Exact action+opportunity priors and action-type fallback priors.
-- The selector only becomes READY after at least N HIGH-confidence experiments.
create or replace view public.commerce_gsc_action_prior_v
with (security_invoker=true)
as
with policy as (
  select
    repository,
    prior_min_high_confidence_experiments,
    prior_favor_score,
    prior_caution_score,
    prior_min_directional_evidence,
    prior_favor_priority_multiplier
  from public.commerce_gsc_executor_policy
),
exact_prior as (
  select
    l.repository,
    l.action_type,
    l.opportunity_type,
    count(*)::int experiments,
    count(*) filter(where l.confidence='HIGH')::int high_confidence_experiments,
    count(*) filter(
      where l.confidence='HIGH' and l.learning_signal='BENEFIT_CONFIRMED'
    )::int benefit_confirmed,
    count(*) filter(
      where l.confidence='HIGH' and l.learning_signal in ('HARM_CONFIRMED','HARM_LIKELY')
    )::int harm_directional,
    case
      when count(*) filter(where l.confidence='HIGH')>0
        then avg(l.signal_weight) filter(where l.confidence='HIGH')
      else 0
    end::numeric prior_score
  from public.commerce_gsc_learning_ledger l
  group by l.repository,l.action_type,l.opportunity_type
),
action_prior as (
  select
    l.repository,
    l.action_type,
    count(*)::int experiments,
    count(*) filter(where l.confidence='HIGH')::int high_confidence_experiments,
    count(*) filter(
      where l.confidence='HIGH' and l.learning_signal='BENEFIT_CONFIRMED'
    )::int benefit_confirmed,
    count(*) filter(
      where l.confidence='HIGH' and l.learning_signal in ('HARM_CONFIRMED','HARM_LIKELY')
    )::int harm_directional,
    case
      when count(*) filter(where l.confidence='HIGH')>0
        then avg(l.signal_weight) filter(where l.confidence='HIGH')
      else 0
    end::numeric prior_score
  from public.commerce_gsc_learning_ledger l
  group by l.repository,l.action_type
),
base as (
  select
    q.id action_id,
    q.priority_score,
    q.action_type,
    q.opportunity_type,
    case
      when q.page like 'https://amphon.co.th/%' then 'noteroru2/amphon.co.th'
      when q.page like 'https://shop.amphon.co.th/%' then 'noteroru2/amphon-product-hub-shop'
      else 'UNSUPPORTED'
    end repository
  from public.commerce_gsc_action_queue q
),
chosen as (
  select
    b.*,
    coalesce(p.prior_min_high_confidence_experiments,3) min_high,
    coalesce(p.prior_favor_score,0.35) favor_score,
    coalesce(p.prior_caution_score,-0.35) caution_score,
    coalesce(p.prior_min_directional_evidence,2) min_directional,
    coalesce(p.prior_favor_priority_multiplier,1.15) favor_multiplier,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then 'EXACT'
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then 'ACTION_TYPE'
      when coalesce(ep.experiments,0)>0 then 'EXACT_COLD_START'
      when coalesce(ap.experiments,0)>0 then 'ACTION_TYPE_COLD_START'
      else 'NONE'
    end prior_scope,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ep.experiments,0)
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ap.experiments,0)
      when coalesce(ep.experiments,0)>0 then coalesce(ep.experiments,0)
      else coalesce(ap.experiments,0)
    end experiments,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ep.high_confidence_experiments,0)
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ap.high_confidence_experiments,0)
      when coalesce(ep.experiments,0)>0 then coalesce(ep.high_confidence_experiments,0)
      else coalesce(ap.high_confidence_experiments,0)
    end high_confidence_experiments,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ep.benefit_confirmed,0)
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ap.benefit_confirmed,0)
      when coalesce(ep.experiments,0)>0 then coalesce(ep.benefit_confirmed,0)
      else coalesce(ap.benefit_confirmed,0)
    end benefit_confirmed,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ep.harm_directional,0)
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ap.harm_directional,0)
      when coalesce(ep.experiments,0)>0 then coalesce(ep.harm_directional,0)
      else coalesce(ap.harm_directional,0)
    end harm_directional,

    case
      when coalesce(ep.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ep.prior_score,0)
      when coalesce(ap.high_confidence_experiments,0) >= coalesce(p.prior_min_high_confidence_experiments,3)
        then coalesce(ap.prior_score,0)
      when coalesce(ep.experiments,0)>0 then coalesce(ep.prior_score,0)
      else coalesce(ap.prior_score,0)
    end prior_score
  from base b
  left join policy p on p.repository=b.repository
  left join exact_prior ep
    on ep.repository=b.repository
   and ep.action_type=b.action_type
   and ep.opportunity_type=b.opportunity_type
  left join action_prior ap
    on ap.repository=b.repository
   and ap.action_type=b.action_type
),
classified as (
  select
    c.*,
    case
      when c.high_confidence_experiments < c.min_high then 'COLD_START'
      when c.prior_score <= c.caution_score
       and c.harm_directional >= c.min_directional then 'CAUTION'
      when c.prior_score >= c.favor_score
       and c.benefit_confirmed >= c.min_directional then 'FAVOR'
      else 'NEUTRAL'
    end prior_state
  from chosen c
)
select
  c.action_id,
  c.repository,
  c.action_type,
  c.opportunity_type,
  c.prior_scope,
  c.prior_state,
  c.experiments,
  c.high_confidence_experiments,
  c.benefit_confirmed,
  c.harm_directional,
  c.prior_score,
  case
    when c.prior_state='FAVOR' then c.priority_score*c.favor_multiplier
    else c.priority_score
  end::numeric prior_adjusted_priority,
  case
    when c.prior_state='COLD_START' then
      'Cold start: only '||c.high_confidence_experiments||'/'||c.min_high||
      ' HIGH-confidence experiments are available. Prior cannot alter execution risk or ordering.'
    when c.prior_state='FAVOR' then
      'Mature positive prior ('||round(c.prior_score,3)||') from '||
      c.high_confidence_experiments||' HIGH-confidence experiments. May rank this already-safe action earlier; hard guards are unchanged.'
    when c.prior_state='CAUTION' then
      'Mature negative prior ('||round(c.prior_score,3)||') with '||
      c.harm_directional||' directional harm result(s). Automatic mutation is downgraded to Human Review.'
    else
      'Mature prior is mixed/neutral ('||round(c.prior_score,3)||
      '). Existing risk gates and base priority remain unchanged.'
  end prior_reason
from classified c;

grant select on public.commerce_gsc_action_prior_v to authenticated,service_role;

create or replace function private.refresh_gsc_learning_prior_snapshots()
returns void
language sql
security definer
set search_path = ''
as $$
update public.commerce_gsc_learning_ledger l
set
  selector_prior_state=j.prior_state,
  selector_prior_scope=j.prior_scope,
  selector_prior_score=j.prior_score,
  selector_prior_high_confidence_experiments=j.prior_high_confidence_experiments,
  selector_prior_checked_at=j.prior_checked_at
from public.commerce_gsc_action_executions e
join public.commerce_gsc_executor_jobs j on j.id=e.executor_job_id
where l.execution_id=e.id
  and (
    l.selector_prior_checked_at is null
    or l.selector_prior_state is distinct from j.prior_state
    or l.selector_prior_scope is distinct from j.prior_scope
    or l.selector_prior_score is distinct from j.prior_score
    or l.selector_prior_high_confidence_experiments is distinct from j.prior_high_confidence_experiments
  );
$$;

revoke all on function private.refresh_gsc_learning_prior_snapshots() from public,anon,authenticated;
grant execute on function private.refresh_gsc_learning_prior_snapshots() to service_role;

create or replace function private.refresh_gsc_prior_selector()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.commerce_gsc_executor_jobs j
  set
    prior_state=p.prior_state,
    prior_scope=p.prior_scope,
    prior_score=p.prior_score,
    prior_experiments=p.experiments,
    prior_high_confidence_experiments=p.high_confidence_experiments,
    prior_benefit_confirmed=p.benefit_confirmed,
    prior_harm_directional=p.harm_directional,
    prior_adjusted_priority=p.prior_adjusted_priority,
    prior_reason=p.prior_reason,
    prior_checked_at=now(),

    -- Mature negative priors may only make automation stricter.
    risk_mode=case
      when p.prior_state='CAUTION'
       and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
       and j.status not in ('RUNNING','VERIFYING','PR_READY','APPLIED','FAILED')
        then 'HUMAN_REVIEW'
      else j.risk_mode
    end,

    status=case
      when p.prior_state='CAUTION'
       and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
       and j.status not in ('RUNNING','VERIFYING','PR_READY','APPLIED','FAILED')
        then 'BLOCKED'
      else j.status
    end,

    reason=case
      when p.prior_state='CAUTION'
       and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
       and j.status not in ('RUNNING','VERIFYING','PR_READY','APPLIED','FAILED')
        then concat_ws(' ',j.reason,'Prior-aware selector: ',p.prior_reason)
      when p.prior_state='FAVOR'
       and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
        then concat_ws(' ',j.reason,'Prior-aware selector: ',p.prior_reason)
      else j.reason
    end,

    updated_at=case
      when j.prior_state is distinct from p.prior_state
        or j.prior_scope is distinct from p.prior_scope
        or j.prior_score is distinct from p.prior_score
        or j.prior_high_confidence_experiments is distinct from p.high_confidence_experiments
      then now()
      else j.updated_at
    end
  from public.commerce_gsc_action_prior_v p
  where p.action_id=j.action_id;

  perform private.refresh_gsc_learning_prior_snapshots();
end;
$$;

revoke all on function private.refresh_gsc_prior_selector() from public,anon,authenticated;
grant execute on function private.refresh_gsc_prior_selector() to service_role;

-- Reinstall base classifier and always apply mature priors afterward.
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
      when public.commerce_gsc_executor_jobs.status in ('RUNNING','VERIFYING','PR_READY','APPLIED','FAILED')
        then public.commerce_gsc_executor_jobs.status
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

  perform private.refresh_gsc_prior_selector();
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
  v_max_claims integer;
  v_budget_limit integer;
  v_budget_used integer;
  v_remaining integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gsc-executor:'||p_repository,0)
  );

  perform private.refresh_gsc_prior_selector();
  perform private.refresh_gsc_executor_guards();

  select
    coalesce(max(p.max_claims_per_run),2),
    coalesce(max(p.max_actions_24h),4)
  into v_max_claims,v_budget_limit
  from public.commerce_gsc_executor_policy p
  where p.repository=p_repository;

  select
    (
      select count(*)::int
      from public.commerce_gsc_action_executions e
      where e.repository=p_repository
        and e.applied_at >= now()-interval '24 hours'
        and e.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
    )
    +
    (
      select count(*)::int
      from public.commerce_gsc_executor_jobs j
      where j.target_repository=p_repository
        and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
        and j.status in ('RUNNING','VERIFYING','PR_READY')
        and not exists (
          select 1 from public.commerce_gsc_action_executions e
          where e.executor_job_id=j.id
        )
    )
  into v_budget_used;

  v_remaining := greatest(0,v_budget_limit-coalesce(v_budget_used,0));
  v_max_claims := greatest(1,least(coalesce(p_limit,2),v_max_claims,5));

  with candidates as (
    select
      j.id,
      j.status,
      a.page,
      a.priority_score,
      j.prior_state,
      j.prior_score,
      j.prior_adjusted_priority,
      row_number() over (
        partition by case when j.status='QUEUED' then a.page else j.id::text end
        order by
          case j.prior_state
            when 'FAVOR' then 0
            when 'NEUTRAL' then 1
            when 'COLD_START' then 2
            else 3
          end,
          j.prior_adjusted_priority desc,
          a.priority_score desc,
          j.updated_at,j.created_at,j.id
      ) as page_rank,
      row_number() over (
        partition by j.status
        order by
          case j.prior_state
            when 'FAVOR' then 0
            when 'NEUTRAL' then 1
            when 'COLD_START' then 2
            else 3
          end,
          j.prior_adjusted_priority desc,
          a.priority_score desc,
          j.updated_at,j.created_at,j.id
      ) as status_rank
    from public.commerce_gsc_executor_jobs j
    join public.commerce_gsc_action_queue a on a.id=j.action_id
    where j.target_repository=p_repository
      and j.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
      and j.status in ('QUEUED','VERIFYING')
      and (j.lease_expires_at is null or j.lease_expires_at < now())
      and (j.status='VERIFYING' or j.guard_code='READY')
  ),
  picked as (
    select c.id
    from candidates c
    where c.status='VERIFYING'
       or (
         c.status='QUEUED'
         and c.page_rank=1
         and c.status_rank <= v_remaining
       )
    order by
      case c.status when 'VERIFYING' then 0 else 1 end,
      c.status_rank
    for update skip locked
    limit v_max_claims
  ),
  claimed as (
    update public.commerce_gsc_executor_jobs j
    set
      status='RUNNING',
      attempts=j.attempts+1,
      lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '20 minutes',
      guard_checked_at=now(),
      prior_checked_at=now(),
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
    'guardCode',j.guard_code,
    'guardReason',j.guard_reason,
    'budgetUsed24h',j.budget_used_24h,
    'budgetLimit24h',j.budget_limit_24h,
    'activePageExperiments',j.active_page_experiments,
    'priorState',j.prior_state,
    'priorScope',j.prior_scope,
    'priorScore',j.prior_score,
    'priorExperiments',j.prior_experiments,
    'priorHighConfidenceExperiments',j.prior_high_confidence_experiments,
    'priorBenefitConfirmed',j.prior_benefit_confirmed,
    'priorHarmDirectional',j.prior_harm_directional,
    'priorAdjustedPriority',j.prior_adjusted_priority,
    'priorReason',j.prior_reason,
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
  ) order by
    case j.prior_state
      when 'FAVOR' then 0
      when 'NEUTRAL' then 1
      when 'COLD_START' then 2
      else 3
    end,
    j.prior_adjusted_priority desc,
    j.updated_at
  ),'[]'::jsonb)
  into result
  from claimed j
  join public.commerce_gsc_action_queue a on a.id=j.action_id
  left join public.commerce_gsc_recovery_diagnostics d on d.action_id=a.id;

  perform private.refresh_gsc_executor_guards();
  return result;
end;
$$;

revoke all on function public.claim_gsc_executor_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_gsc_executor_jobs(text,integer) to service_role;

select private.refresh_gsc_executor_jobs();
select private.refresh_gsc_prior_selector();
select private.refresh_gsc_executor_guards();

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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_gsc_prior_selector(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements(); select private.refresh_gsc_rollback_recovery_measurements(); select private.refresh_gsc_learning_ledger(); select private.refresh_gsc_learning_prior_snapshots(); select private.refresh_gsc_prior_selector(); select private.refresh_gsc_executor_guards();'
);

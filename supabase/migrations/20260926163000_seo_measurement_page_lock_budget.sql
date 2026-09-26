-- SEO Safety Layer: Measurement Integrity Guard + Page Experiment Lock + Action Budget
-- Production policy: one active experiment per URL, at most 4 mutating SEO actions per rolling 24h,
-- and only integrity-passing GSC measurements may produce IMPROVED/REGRESSED verdicts.

-- ============================================================
-- POLICY
-- ============================================================

create table if not exists public.commerce_gsc_executor_policy (
  repository text primary key,
  max_actions_24h integer not null default 4 check (max_actions_24h between 1 and 20),
  max_claims_per_run integer not null default 2 check (max_claims_per_run between 1 and 5),
  max_active_experiments_per_page integer not null default 1 check (max_active_experiments_per_page between 1 and 5),
  measurement_min_impressions integer not null default 20 check (measurement_min_impressions between 5 and 1000),
  measurement_max_data_age_hours integer not null default 48 check (measurement_max_data_age_hours between 6 and 168),
  measurement_max_baseline_age_hours integer not null default 72 check (measurement_max_baseline_age_hours between 6 and 336),
  measurement_max_query_share_shift numeric not null default 0.30 check (measurement_max_query_share_shift between 0.05 and 1),
  measurement_min_traffic_ratio numeric not null default 0.35 check (measurement_min_traffic_ratio > 0 and measurement_min_traffic_ratio <= 1),
  measurement_max_traffic_ratio numeric not null default 2.85 check (measurement_max_traffic_ratio >= 1),
  updated_at timestamptz not null default now()
);

alter table public.commerce_gsc_executor_policy enable row level security;
drop policy if exists commerce_gsc_executor_policy_read_admin on public.commerce_gsc_executor_policy;
create policy commerce_gsc_executor_policy_read_admin
on public.commerce_gsc_executor_policy
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_executor_policy from anon;
revoke insert,update,delete on public.commerce_gsc_executor_policy from authenticated;
grant select on public.commerce_gsc_executor_policy to authenticated;
grant select,insert,update,delete on public.commerce_gsc_executor_policy to service_role;

insert into public.commerce_gsc_executor_policy(
  repository,max_actions_24h,max_claims_per_run,max_active_experiments_per_page,
  measurement_min_impressions,measurement_max_data_age_hours,measurement_max_baseline_age_hours,
  measurement_max_query_share_shift,measurement_min_traffic_ratio,measurement_max_traffic_ratio
)
values ('noteroru2/amphon.co.th',4,2,1,20,48,72,0.30,0.35,2.85)
on conflict (repository) do update set
  max_actions_24h=excluded.max_actions_24h,
  max_claims_per_run=excluded.max_claims_per_run,
  max_active_experiments_per_page=excluded.max_active_experiments_per_page,
  measurement_min_impressions=excluded.measurement_min_impressions,
  measurement_max_data_age_hours=excluded.measurement_max_data_age_hours,
  measurement_max_baseline_age_hours=excluded.measurement_max_baseline_age_hours,
  measurement_max_query_share_shift=excluded.measurement_max_query_share_shift,
  measurement_min_traffic_ratio=excluded.measurement_min_traffic_ratio,
  measurement_max_traffic_ratio=excluded.measurement_max_traffic_ratio,
  updated_at=now();

-- ============================================================
-- PAGE LOCK + ACTION BUDGET EVIDENCE
-- ============================================================

alter table public.commerce_gsc_executor_jobs
  add column if not exists guard_code text not null default 'READY'
    check (guard_code in ('READY','PAGE_EXPERIMENT_LOCK','ACTION_BUDGET','RISK_GATE','PROTECTED')),
  add column if not exists guard_reason text,
  add column if not exists guard_checked_at timestamptz,
  add column if not exists next_eligible_at timestamptz,
  add column if not exists budget_used_24h integer not null default 0,
  add column if not exists budget_limit_24h integer not null default 4,
  add column if not exists active_page_experiments integer not null default 0,
  add column if not exists page_lock_execution_id uuid references public.commerce_gsc_action_executions(id) on delete set null;

create index if not exists commerce_gsc_executor_jobs_guard_idx
  on public.commerce_gsc_executor_jobs(target_repository,guard_code,status,updated_at);

-- Hard backstop: one live measured experiment per repository+URL.
create unique index if not exists commerce_gsc_active_page_experiment_uidx
  on public.commerce_gsc_action_executions(repository,live_url)
  where monitor_status in ('MONITORING','ROLLBACK_REVIEW')
    and rollback_status <> 'ROLLED_BACK'
    and repository is not null
    and live_url is not null;

create or replace function private.refresh_gsc_executor_guards()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with base as (
    select
      j.id,
      j.action_id,
      j.risk_mode,
      j.status,
      j.target_repository,
      a.page,
      coalesce(p.max_actions_24h,4) as budget_limit,
      coalesce(p.max_active_experiments_per_page,1) as page_limit,

      (
        select count(*)::int
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.applied_at >= now()-interval '24 hours'
          and e.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
      )
      +
      (
        select count(*)::int
        from public.commerce_gsc_executor_jobs j2
        where j2.target_repository=j.target_repository
          and j2.id<>j.id
          and j2.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
          and j2.status in ('RUNNING','VERIFYING','PR_READY')
          and not exists (
            select 1 from public.commerce_gsc_action_executions e2
            where e2.executor_job_id=j2.id
          )
      ) as budget_used,

      (
        select count(*)::int
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.live_url=a.page
          and e.action_id<>j.action_id
          and e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
          and e.rollback_status<>'ROLLED_BACK'
      )
      +
      (
        select count(*)::int
        from public.commerce_gsc_executor_jobs j2
        join public.commerce_gsc_action_queue a2 on a2.id=j2.action_id
        where j2.target_repository=j.target_repository
          and j2.id<>j.id
          and a2.page=a.page
          and j2.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
          and j2.status in ('RUNNING','VERIFYING','PR_READY')
          and not exists (
            select 1 from public.commerce_gsc_action_executions e2
            where e2.executor_job_id=j2.id
          )
      ) as active_page_count,

      (
        select e.id
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.live_url=a.page
          and e.action_id<>j.action_id
          and e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
          and e.rollback_status<>'ROLLED_BACK'
        order by e.applied_at desc
        limit 1
      ) as lock_execution_id,

      (
        select min(e.applied_at + interval '28 days')
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.live_url=a.page
          and e.action_id<>j.action_id
          and e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
          and e.rollback_status<>'ROLLED_BACK'
      ) as page_estimated_release,

      (
        select min(e.applied_at + interval '24 hours')
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.applied_at >= now()-interval '24 hours'
          and e.risk_mode in ('AUTO_DEPLOY','PR_ONLY')
      ) as budget_release
    from public.commerce_gsc_executor_jobs j
    join public.commerce_gsc_action_queue a on a.id=j.action_id
    left join public.commerce_gsc_executor_policy p on p.repository=j.target_repository
  ),
  guarded as (
    select
      b.*,
      case
        when b.risk_mode='PROTECT' then 'PROTECTED'
        when b.risk_mode not in ('AUTO_DEPLOY','PR_ONLY') then 'RISK_GATE'
        -- Once execution is already underway, do not retroactively stop it with a waiting guard.
        when b.status in ('RUNNING','VERIFYING','PR_READY','APPLIED') then 'READY'
        when b.active_page_count >= b.page_limit then 'PAGE_EXPERIMENT_LOCK'
        when b.budget_used >= b.budget_limit then 'ACTION_BUDGET'
        else 'READY'
      end as next_guard
    from base b
  )
  update public.commerce_gsc_executor_jobs j
  set
    guard_code=g.next_guard,
    guard_reason=case
      when g.next_guard='PROTECTED' then
        'PROTECT_PAGE is non-mutating; Title/H1/URL/Canonical remain locked.'
      when g.next_guard='RISK_GATE' then
        'Risk gate requires human review/observe mode; automatic mutation is not claimable.'
      when g.next_guard='PAGE_EXPERIMENT_LOCK' then
        'Page Experiment Lock: '||g.active_page_count||' active experiment(s) already own this URL. Wait for the current 7/14/28 measurement cycle or rollback to finish.'
      when g.next_guard='ACTION_BUDGET' then
        'Action Budget: '||g.budget_used||'/'||g.budget_limit||' mutating SEO action slots are already used/reserved in the rolling 24h window.'
      else
        'Safety guards passed: page has no competing active experiment and action budget has capacity.'
    end,
    guard_checked_at=now(),
    next_eligible_at=case
      when g.next_guard='PAGE_EXPERIMENT_LOCK' then g.page_estimated_release
      when g.next_guard='ACTION_BUDGET' then g.budget_release
      else null
    end,
    budget_used_24h=g.budget_used,
    budget_limit_24h=g.budget_limit,
    active_page_experiments=g.active_page_count,
    page_lock_execution_id=g.lock_execution_id,
    updated_at=case
      when j.guard_code is distinct from g.next_guard then now()
      else j.updated_at
    end
  from guarded g
  where j.id=g.id;
end;
$$;

revoke all on function private.refresh_gsc_executor_guards() from public,anon,authenticated;
grant execute on function private.refresh_gsc_executor_guards() to service_role;

-- ============================================================
-- ALIGNED PRIMARY-QUERY BASELINE
-- ============================================================

alter table public.commerce_gsc_action_executions
  add column if not exists baseline_query_clicks numeric,
  add column if not exists baseline_query_impressions numeric,
  add column if not exists baseline_query_ctr numeric,
  add column if not exists baseline_query_position numeric,
  add column if not exists baseline_page_impressions numeric,
  add column if not exists baseline_query_share numeric,
  add column if not exists baseline_query_fetched_at timestamptz;

create or replace function private.capture_gsc_execution_integrity_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.commerce_gsc_action_queue;
  d public.commerce_gsc_query_demand;
  v_page_impressions numeric;
begin
  if new.baseline_query_fetched_at is not null then
    return new;
  end if;

  select * into a
  from public.commerce_gsc_action_queue
  where id=new.action_id;

  if a.id is null then
    return new;
  end if;

  select * into d
  from public.commerce_gsc_query_demand x
  where x.property=a.property
    and x.page=a.page
    and x.window_days=28
    and lower(x.query)=lower(a.primary_query)
  order by x.fetched_at desc
  limit 1;

  if d.id is null then
    return new;
  end if;

  select coalesce(sum(x.impressions),0)
  into v_page_impressions
  from public.commerce_gsc_query_demand x
  where x.property=a.property
    and x.page=a.page
    and x.window_days=28
    and x.fetched_at between d.fetched_at-interval '10 minutes' and d.fetched_at+interval '10 minutes';

  new.baseline_query_clicks := d.clicks;
  new.baseline_query_impressions := d.impressions;
  new.baseline_query_ctr := d.ctr;
  new.baseline_query_position := d.position;
  new.baseline_page_impressions := v_page_impressions;
  new.baseline_query_share := case when v_page_impressions>0 then d.impressions/v_page_impressions else 0 end;
  new.baseline_query_fetched_at := d.fetched_at;
  return new;
end;
$$;

drop trigger if exists commerce_gsc_execution_integrity_baseline on public.commerce_gsc_action_executions;
create trigger commerce_gsc_execution_integrity_baseline
before insert on public.commerce_gsc_action_executions
for each row
execute function private.capture_gsc_execution_integrity_baseline();

create or replace function private.backfill_gsc_execution_integrity_baselines()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  d public.commerce_gsc_query_demand;
  v_page_impressions numeric;
begin
  for e in
    select x.id,x.action_id,a.property,a.page,a.primary_query
    from public.commerce_gsc_action_executions x
    join public.commerce_gsc_action_queue a on a.id=x.action_id
    where x.baseline_query_fetched_at is null
      and x.executor_job_id is not null
  loop
    d := null;

    select * into d
    from public.commerce_gsc_query_demand q
    where q.property=e.property
      and q.page=e.page
      and q.window_days=28
      and lower(q.query)=lower(e.primary_query)
    order by q.fetched_at desc
    limit 1;

    if d.id is null then
      continue;
    end if;

    select coalesce(sum(q.impressions),0)
    into v_page_impressions
    from public.commerce_gsc_query_demand q
    where q.property=e.property
      and q.page=e.page
      and q.window_days=28
      and q.fetched_at between d.fetched_at-interval '10 minutes' and d.fetched_at+interval '10 minutes';

    update public.commerce_gsc_action_executions
    set
      baseline_query_clicks=d.clicks,
      baseline_query_impressions=d.impressions,
      baseline_query_ctr=d.ctr,
      baseline_query_position=d.position,
      baseline_page_impressions=v_page_impressions,
      baseline_query_share=case when v_page_impressions>0 then d.impressions/v_page_impressions else 0 end,
      baseline_query_fetched_at=d.fetched_at
    where id=e.id
      and baseline_query_fetched_at is null;
  end loop;
end;
$$;

revoke all on function private.backfill_gsc_execution_integrity_baselines() from public,anon,authenticated;
grant execute on function private.backfill_gsc_execution_integrity_baselines() to service_role;

select private.backfill_gsc_execution_integrity_baselines();

-- ============================================================
-- MEASUREMENT INTEGRITY EVIDENCE
-- ============================================================

alter table public.commerce_gsc_action_measurements
  add column if not exists integrity_status text not null default 'BLOCKED'
    check (integrity_status in ('PASS','BLOCKED')),
  add column if not exists integrity_codes text[] not null default '{}'::text[],
  add column if not exists integrity_reason text,
  add column if not exists data_age_hours numeric,
  add column if not exists baseline_age_hours numeric,
  add column if not exists exposure_days numeric,
  add column if not exists baseline_query_share numeric,
  add column if not exists current_query_share numeric,
  add column if not exists query_share_shift numeric,
  add column if not exists traffic_ratio numeric;

create or replace function private.refresh_gsc_action_measurements()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_checkpoint integer;
  v_clicks numeric;
  v_impressions numeric;
  v_ctr numeric;
  v_position numeric;
  v_fetched timestamptz;
  v_page_impressions numeric;
  v_current_share numeric;
  v_share_shift numeric;
  v_traffic_ratio numeric;
  v_data_age_hours numeric;
  v_baseline_age_hours numeric;
  v_exposure_days numeric;
  v_min_impressions integer;
  v_max_data_age_hours integer;
  v_max_baseline_age_hours integer;
  v_max_query_share_shift numeric;
  v_min_traffic_ratio numeric;
  v_max_traffic_ratio numeric;
  v_codes text[];
  v_integrity text;
  v_integrity_reason text;
  v_verdict text;
  v_rollback boolean;
begin
  for e in
    select
      x.*,
      a.property,a.page,a.primary_query,a.opportunity_type,a.action_type
    from public.commerce_gsc_action_executions x
    join public.commerce_gsc_action_queue a on a.id=x.action_id
    where x.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
      and x.rollback_status <> 'ROLLED_BACK'
      and x.applied_at <= now() - interval '7 days'
    order by x.applied_at
  loop
    v_checkpoint := null;

    if e.applied_at <= now() - interval '28 days'
       and (
         not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=28)
         or exists(
           select 1 from public.commerce_gsc_action_measurements m
           where m.execution_id=e.id and m.checkpoint_days=28
             and m.verdict='INSUFFICIENT_DATA'
             and m.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 28;
    elsif e.applied_at <= now() - interval '14 days'
       and (
         not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=14)
         or exists(
           select 1 from public.commerce_gsc_action_measurements m
           where m.execution_id=e.id and m.checkpoint_days=14
             and m.verdict='INSUFFICIENT_DATA'
             and m.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 14;
    elsif e.applied_at <= now() - interval '7 days'
       and (
         not exists(select 1 from public.commerce_gsc_action_measurements m where m.execution_id=e.id and m.checkpoint_days=7)
         or exists(
           select 1 from public.commerce_gsc_action_measurements m
           where m.execution_id=e.id and m.checkpoint_days=7
             and m.verdict='INSUFFICIENT_DATA'
             and m.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 7;
    end if;

    if v_checkpoint is null then
      continue;
    end if;

    select
      coalesce(max(p.measurement_min_impressions),20),
      coalesce(max(p.measurement_max_data_age_hours),48),
      coalesce(max(p.measurement_max_baseline_age_hours),72),
      coalesce(max(p.measurement_max_query_share_shift),0.30),
      coalesce(max(p.measurement_min_traffic_ratio),0.35),
      coalesce(max(p.measurement_max_traffic_ratio),2.85)
    into
      v_min_impressions,v_max_data_age_hours,v_max_baseline_age_hours,
      v_max_query_share_shift,v_min_traffic_ratio,v_max_traffic_ratio
    from public.commerce_gsc_executor_policy p
    where p.repository=coalesce(e.repository,'noteroru2/amphon.co.th');

    v_clicks := null;
    v_impressions := null;
    v_ctr := null;
    v_position := null;
    v_fetched := null;
    v_page_impressions := null;

    select d.clicks,d.impressions,d.ctr,d.position,d.fetched_at
    into v_clicks,v_impressions,v_ctr,v_position,v_fetched
    from public.commerce_gsc_query_demand d
    where d.property=e.property
      and d.page=e.page
      and d.window_days=28
      and lower(d.query)=lower(e.primary_query)
    order by d.fetched_at desc
    limit 1;

    if v_fetched is not null then
      select coalesce(sum(d.impressions),0)
      into v_page_impressions
      from public.commerce_gsc_query_demand d
      where d.property=e.property
        and d.page=e.page
        and d.window_days=28
        and d.fetched_at between v_fetched-interval '10 minutes' and v_fetched+interval '10 minutes';
    end if;

    v_current_share := case
      when coalesce(v_page_impressions,0)>0 and v_impressions is not null then v_impressions/v_page_impressions
      else null
    end;
    v_share_shift := case
      when v_current_share is not null and e.baseline_query_share is not null
        then abs(v_current_share-e.baseline_query_share)
      else null
    end;
    v_traffic_ratio := case
      when coalesce(e.baseline_page_impressions,0)>0 and v_page_impressions is not null
        then v_page_impressions/e.baseline_page_impressions
      else null
    end;
    v_data_age_hours := case when v_fetched is not null
      then extract(epoch from (now()-v_fetched))/3600.0 else null end;
    v_baseline_age_hours := case when e.baseline_query_fetched_at is not null
      then extract(epoch from (e.applied_at-e.baseline_query_fetched_at))/3600.0 else null end;
    v_exposure_days := case when v_fetched is not null
      then extract(epoch from (v_fetched-e.applied_at))/86400.0 else null end;

    v_codes := '{}'::text[];

    if e.baseline_query_fetched_at is null
       or e.baseline_query_impressions is null
       or e.baseline_query_ctr is null
       or e.baseline_query_position is null then
      v_codes := array_append(v_codes,'NO_ALIGNED_BASELINE');
    end if;

    if v_baseline_age_hours is not null and (v_baseline_age_hours < -1 or v_baseline_age_hours > v_max_baseline_age_hours) then
      v_codes := array_append(v_codes,'STALE_BASELINE');
    end if;

    if v_fetched is null or v_impressions is null then
      v_codes := array_append(v_codes,'NO_CURRENT_QUERY');
    else
      if v_data_age_hours > v_max_data_age_hours then
        v_codes := array_append(v_codes,'STALE_SOURCE');
      end if;
      if v_exposure_days < greatest(1,v_checkpoint-2) then
        v_codes := array_append(v_codes,'LOW_POST_CHANGE_EXPOSURE');
      end if;
    end if;

    if coalesce(e.baseline_query_impressions,0) < v_min_impressions then
      v_codes := array_append(v_codes,'LOW_BASELINE_SAMPLE');
    end if;

    if coalesce(v_impressions,0) < v_min_impressions then
      v_codes := array_append(v_codes,'LOW_CURRENT_SAMPLE');
    end if;

    if v_traffic_ratio is not null
       and (v_traffic_ratio < v_min_traffic_ratio or v_traffic_ratio > v_max_traffic_ratio) then
      v_codes := array_append(v_codes,'TRAFFIC_ANOMALY');
    end if;

    if v_share_shift is not null and v_share_shift > v_max_query_share_shift then
      v_codes := array_append(v_codes,'QUERY_MIX_SHIFT');
    end if;

    v_integrity := case when cardinality(v_codes)=0 then 'PASS' else 'BLOCKED' end;
    v_integrity_reason := case
      when v_integrity='PASS' then
        'Integrity PASS: aligned primary-query baseline/current 28d snapshot, fresh source, sufficient sample, stable page traffic/query mix, and enough post-change exposure.'
      else
        'Integrity BLOCKED: '||array_to_string(v_codes,', ')||'. Verdict forced to INSUFFICIENT_DATA; rollback is forbidden.'
    end;

    if v_integrity='BLOCKED' then
      v_verdict := 'INSUFFICIENT_DATA';
      v_rollback := false;
    elsif
      (v_position <= e.baseline_query_position - 0.5 and v_ctr >= e.baseline_query_ctr * 0.85)
      or
      (v_ctr >= greatest(e.baseline_query_ctr * 1.15, e.baseline_query_ctr + 0.005)
       and v_position <= e.baseline_query_position + 0.75)
    then
      v_verdict := 'IMPROVED';
      v_rollback := false;
    elsif
      (v_position >= e.baseline_query_position + 1.0 and v_ctr <= e.baseline_query_ctr * 1.10)
      or
      (e.baseline_query_ctr > 0
       and v_ctr <= e.baseline_query_ctr * 0.75
       and v_impressions >= greatest(v_min_impressions,20)
       and v_position >= e.baseline_query_position - 0.25)
    then
      v_verdict := 'REGRESSED';
      v_rollback := e.action_type not in ('PROTECT_PAGE','BRAND_WATCH');
    else
      v_verdict := 'NEUTRAL';
      v_rollback := false;
    end if;

    insert into public.commerce_gsc_action_measurements(
      execution_id,checkpoint_days,measured_at,
      clicks,impressions,ctr,position,
      clicks_delta,impressions_delta,ctr_delta,position_delta,
      verdict,rollback_recommended,source_fetched_at,
      integrity_status,integrity_codes,integrity_reason,
      data_age_hours,baseline_age_hours,exposure_days,
      baseline_query_share,current_query_share,query_share_shift,traffic_ratio
    ) values (
      e.id,v_checkpoint,now(),
      coalesce(v_clicks,0),coalesce(v_impressions,0),coalesce(v_ctr,0),coalesce(v_position,0),
      coalesce(v_clicks,0)-coalesce(e.baseline_query_clicks,0),
      coalesce(v_impressions,0)-coalesce(e.baseline_query_impressions,0),
      coalesce(v_ctr,0)-coalesce(e.baseline_query_ctr,0),
      coalesce(v_position,0)-coalesce(e.baseline_query_position,0),
      v_verdict,v_rollback,v_fetched,
      v_integrity,v_codes,v_integrity_reason,
      v_data_age_hours,v_baseline_age_hours,v_exposure_days,
      e.baseline_query_share,v_current_share,v_share_shift,v_traffic_ratio
    )
    on conflict (execution_id,checkpoint_days) do update set
      measured_at=excluded.measured_at,
      clicks=excluded.clicks,
      impressions=excluded.impressions,
      ctr=excluded.ctr,
      position=excluded.position,
      clicks_delta=excluded.clicks_delta,
      impressions_delta=excluded.impressions_delta,
      ctr_delta=excluded.ctr_delta,
      position_delta=excluded.position_delta,
      verdict=excluded.verdict,
      rollback_recommended=excluded.rollback_recommended,
      source_fetched_at=excluded.source_fetched_at,
      integrity_status=excluded.integrity_status,
      integrity_codes=excluded.integrity_codes,
      integrity_reason=excluded.integrity_reason,
      data_age_hours=excluded.data_age_hours,
      baseline_age_hours=excluded.baseline_age_hours,
      exposure_days=excluded.exposure_days,
      baseline_query_share=excluded.baseline_query_share,
      current_query_share=excluded.current_query_share,
      query_share_shift=excluded.query_share_shift,
      traffic_ratio=excluded.traffic_ratio
    where public.commerce_gsc_action_measurements.verdict='INSUFFICIENT_DATA';

    update public.commerce_gsc_action_executions
    set
      last_measured_at=now(),
      monitor_status=case
        when v_rollback then 'ROLLBACK_REVIEW'
        when v_checkpoint=28 and v_verdict <> 'INSUFFICIENT_DATA' then 'COMPLETE'
        else 'MONITORING'
      end,
      rollback_review_reason=case
        when v_rollback then
          'GSC checkpoint '||v_checkpoint||'d passed Measurement Integrity Guard and REGRESSED; automatic rollback is eligible.'
        when v_integrity='BLOCKED' then
          'Measurement Integrity Guard blocked checkpoint '||v_checkpoint||'d: '||array_to_string(v_codes,', ')
        else rollback_review_reason
      end
    where id=e.id;
  end loop;

  perform private.refresh_gsc_executor_guards();
end;
$$;

revoke all on function private.refresh_gsc_action_measurements() from public,anon,authenticated;
grant execute on function private.refresh_gsc_action_measurements() to service_role;

-- ============================================================
-- CLAIM: SERIALIZED + PAGE-UNIQUE + BUDGET-CAPPED
-- ============================================================

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
  -- Serialize claims for one repo so two workflows cannot spend the same action-budget slot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gsc-executor:'||p_repository,0));

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
      row_number() over (
        partition by case when j.status='QUEUED' then a.page else j.id::text end
        order by j.updated_at,j.created_at,j.id
      ) as page_rank,
      row_number() over (
        partition by j.status
        order by j.updated_at,j.created_at,j.id
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
    order by case c.status when 'VERIFYING' then 0 else 1 end,c.status_rank
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

  perform private.refresh_gsc_executor_guards();
  return result;
end;
$$;

revoke all on function public.claim_gsc_executor_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.claim_gsc_executor_jobs(text,integer) to service_role;

-- Approval/retry should immediately calculate the new waiting guards instead of waiting for cron.
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
  perform private.refresh_gsc_executor_guards();
  return result_row;
end;
$$;

revoke all on function public.set_gsc_action_status(uuid,text,text) from public;
revoke all on function public.set_gsc_action_status(uuid,text,text) from anon;
grant execute on function public.set_gsc_action_status(uuid,text,text) to authenticated,service_role;

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

  if j.id is null then raise exception 'GSC_EXECUTOR_JOB_NOT_FOUND'; end if;
  if j.risk_mode not in ('AUTO_DEPLOY','PR_ONLY') then raise exception 'EXECUTOR_RETRY_NOT_ALLOWED_FOR_RISK_MODE'; end if;
  if j.status not in ('FAILED','BLOCKED') then raise exception 'EXECUTOR_RETRY_NOT_ALLOWED_FOR_STATUS'; end if;

  update public.commerce_gsc_executor_jobs
  set status='QUEUED',last_error=null,lease_token=null,lease_expires_at=null,updated_at=now()
  where id=p_job_id
  returning * into j;

  perform private.refresh_gsc_executor_guards();

  select * into j
  from public.commerce_gsc_executor_jobs
  where id=p_job_id;

  return j;
end;
$$;

revoke all on function public.retry_gsc_executor_job(uuid) from public,anon;
grant execute on function public.retry_gsc_executor_job(uuid) to authenticated,service_role;

-- Executor job classification remains the authority for risk mode. Re-run guards after every refresh.
create or replace function private.refresh_gsc_executor_jobs_with_guards()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_gsc_executor_jobs();
  perform private.refresh_gsc_executor_guards();
end;
$$;

revoke all on function private.refresh_gsc_executor_jobs_with_guards() from public,anon,authenticated;
grant execute on function private.refresh_gsc_executor_jobs_with_guards() to service_role;

select private.refresh_gsc_executor_guards();

-- Keep governance order explicit: classify -> measure/release locks -> refresh guards.
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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements(); select private.refresh_gsc_executor_guards();'
);

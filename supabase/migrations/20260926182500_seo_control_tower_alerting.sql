-- SEO Control Tower + in-Hub Alerting
-- One operational surface for experiments, measurements, rollback/recovery, learning and anomalies.

create table if not exists public.commerce_seo_alerts (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  alert_type text not null check (alert_type in (
    'EXECUTOR_FAILED',
    'ROLLBACK_PROBLEM',
    'REGRESSED',
    'CAUSAL_CONTAMINATION',
    'SITEWIDE_VOLATILITY',
    'RECOVERY_FAILED',
    'RECOVERY_BLOCKED',
    'EXPERIMENT_OVERDUE',
    'RECOVERY_OVERDUE'
  )),
  severity text not null check (severity in ('INFO','WARNING','CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  generation integer not null default 1 check (generation >= 1),
  action_id uuid references public.commerce_gsc_action_queue(id) on delete set null,
  execution_id uuid references public.commerce_gsc_action_executions(id) on delete set null,
  source_id uuid,
  primary_query text,
  page text,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists commerce_seo_alerts_open_idx
  on public.commerce_seo_alerts(status,severity,last_seen_at desc);

alter table public.commerce_seo_alerts enable row level security;
drop policy if exists commerce_seo_alerts_read_admin on public.commerce_seo_alerts;
create policy commerce_seo_alerts_read_admin
on public.commerce_seo_alerts
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_seo_alerts from anon;
revoke insert,update,delete on public.commerce_seo_alerts from authenticated;
grant select on public.commerce_seo_alerts to authenticated;
grant select,insert,update,delete on public.commerce_seo_alerts to service_role;

create table if not exists public.commerce_seo_alert_receipts (
  alert_id uuid not null references public.commerce_seo_alerts(id) on delete cascade,
  generation integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key(alert_id,generation,user_id)
);

alter table public.commerce_seo_alert_receipts enable row level security;
drop policy if exists commerce_seo_alert_receipts_read_own on public.commerce_seo_alert_receipts;
create policy commerce_seo_alert_receipts_read_own
on public.commerce_seo_alert_receipts
for select to authenticated
using (
  user_id=auth.uid()
  and public.current_user_role() in ('owner','admin')
);

revoke all on public.commerce_seo_alert_receipts from anon;
revoke insert,update,delete on public.commerce_seo_alert_receipts from authenticated;
grant select on public.commerce_seo_alert_receipts to authenticated;
grant select,insert,update,delete on public.commerce_seo_alert_receipts to service_role;

create or replace view public.commerce_seo_control_tower_experiments_v
with (security_invoker=true)
as
with measurement_flags as (
  select
    e.id execution_id,
    bool_or(m.checkpoint_days=7 and m.verdict<>'INSUFFICIENT_DATA') has_7,
    bool_or(m.checkpoint_days=14 and m.verdict<>'INSUFFICIENT_DATA') has_14,
    bool_or(m.checkpoint_days=28 and m.verdict<>'INSUFFICIENT_DATA') has_28
  from public.commerce_gsc_action_executions e
  left join public.commerce_gsc_action_measurements m on m.execution_id=e.id
  group by e.id
),
latest_measurement as (
  select distinct on (m.execution_id)
    m.execution_id,m.checkpoint_days,m.measured_at,m.verdict,m.integrity_status,
    m.position_delta,m.ctr_delta,m.causal_status,m.volatility_status,
    m.contaminating_commit_count,m.volatility_peer_count,m.volatility_median_position_delta
  from public.commerce_gsc_action_measurements m
  order by m.execution_id,m.checkpoint_days desc,m.measured_at desc
),
latest_recovery as (
  select distinct on (r.execution_id)
    r.execution_id,r.checkpoint_days,r.maturity,r.measured_at,r.verdict,r.integrity_status,
    r.causal_status,r.volatility_status
  from public.commerce_gsc_rollback_recovery_measurements r
  order by r.execution_id,r.checkpoint_days desc,r.measured_at desc
)
select
  e.id execution_id,
  e.action_id,
  q.primary_query,
  q.page,
  q.action_type,
  q.opportunity_type,
  e.applied_at,
  e.monitor_status,
  e.rollback_status,
  e.rolled_back_at,
  e.recovery_status,
  e.recovery_final_verdict,
  e.recovery_lock_until,
  case
    when e.monitor_status in ('MONITORING','ROLLBACK_REVIEW') and e.rollback_status<>'ROLLED_BACK' then
      case
        when not coalesce(f.has_7,false) then 7
        when not coalesce(f.has_14,false) then 14
        when not coalesce(f.has_28,false) then 28
        else null
      end
    else null
  end next_checkpoint_days,
  case
    when e.monitor_status in ('MONITORING','ROLLBACK_REVIEW') and e.rollback_status<>'ROLLED_BACK' then
      case
        when not coalesce(f.has_7,false) then e.applied_at+interval '7 days'
        when not coalesce(f.has_14,false) then e.applied_at+interval '14 days'
        when not coalesce(f.has_28,false) then e.applied_at+interval '28 days'
        else null
      end
    else null
  end next_checkpoint_due_at,
  lm.checkpoint_days latest_checkpoint_days,
  lm.measured_at latest_measured_at,
  lm.verdict latest_verdict,
  lm.integrity_status latest_integrity_status,
  lm.position_delta latest_position_delta,
  lm.ctr_delta latest_ctr_delta,
  lm.causal_status latest_causal_status,
  lm.volatility_status latest_volatility_status,
  lm.contaminating_commit_count,
  lm.volatility_peer_count,
  lm.volatility_median_position_delta,
  lr.checkpoint_days latest_recovery_checkpoint_days,
  lr.maturity latest_recovery_maturity,
  lr.measured_at latest_recovery_measured_at,
  lr.verdict latest_recovery_verdict,
  lr.integrity_status latest_recovery_integrity_status,
  lr.causal_status latest_recovery_causal_status,
  lr.volatility_status latest_recovery_volatility_status,
  j.risk_mode,
  j.guard_code,
  j.prior_state,
  j.prior_score,
  l.learning_signal,
  l.confidence learning_confidence,
  l.evidence_count
from public.commerce_gsc_action_executions e
join public.commerce_gsc_action_queue q on q.id=e.action_id
left join measurement_flags f on f.execution_id=e.id
left join latest_measurement lm on lm.execution_id=e.id
left join latest_recovery lr on lr.execution_id=e.id
left join public.commerce_gsc_executor_jobs j on j.id=e.executor_job_id
left join public.commerce_gsc_learning_ledger l on l.execution_id=e.id;

grant select on public.commerce_seo_control_tower_experiments_v to authenticated,service_role;

create or replace view public.commerce_seo_alert_inbox_v
with (security_invoker=true)
as
select
  a.*,
  (r.acknowledged_at is not null) acknowledged,
  r.acknowledged_at
from public.commerce_seo_alerts a
left join public.commerce_seo_alert_receipts r
  on r.alert_id=a.id
 and r.generation=a.generation
 and r.user_id=auth.uid();

grant select on public.commerce_seo_alert_inbox_v to authenticated,service_role;

create or replace view public.commerce_seo_control_tower_summary_v
with (security_invoker=true)
as
select
  (select count(*)::int
   from public.commerce_gsc_action_executions e
   where e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
     and e.rollback_status<>'ROLLED_BACK') active_experiments,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.next_checkpoint_days=7) waiting_7d,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.next_checkpoint_days=14) waiting_14d,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.next_checkpoint_days=28) waiting_28d,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.latest_verdict='IMPROVED') improved,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.latest_verdict='REGRESSED') regressed,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.latest_verdict='CONTAMINATED') contaminated,

  (select count(*)::int
   from public.commerce_seo_control_tower_experiments_v e
   where e.latest_verdict='EXTERNAL_SHIFT') external_shift,

  (select count(*)::int
   from public.commerce_gsc_rollback_jobs r
   where r.status in ('QUEUED','RUNNING','VERIFYING')) rollback_active,

  (select count(*)::int
   from public.commerce_gsc_rollback_jobs r
   where r.status in ('FAILED','BLOCKED')) rollback_problem,

  (select count(*)::int
   from public.commerce_gsc_action_executions e
   where e.recovery_status='MONITORING') recovery_monitoring,

  (select count(*)::int
   from public.commerce_gsc_learning_ledger l
   where l.confidence='HIGH') learning_high,

  (select count(*)::int
   from public.commerce_gsc_executor_jobs j
   where j.prior_state='FAVOR') prior_favor,

  (select count(*)::int
   from public.commerce_gsc_executor_jobs j
   where j.prior_state='CAUTION') prior_caution,

  (select count(*)::int
   from public.commerce_gsc_executor_jobs j
   join public.commerce_gsc_action_queue q on q.id=j.action_id
   where q.status='APPROVED'
     and j.status='BLOCKED'
     and j.risk_mode='HUMAN_REVIEW') human_review,

  (select count(*)::int
   from public.commerce_seo_alert_inbox_v a
   where a.status='OPEN') open_alerts,

  (select count(*)::int
   from public.commerce_seo_alert_inbox_v a
   where a.status='OPEN' and not a.acknowledged) unread_alerts,

  (select count(*)::int
   from public.commerce_seo_alert_inbox_v a
   where a.status='OPEN' and a.severity='CRITICAL') critical_alerts,

  now() generated_at;

grant select on public.commerce_seo_control_tower_summary_v to authenticated,service_role;

create or replace function public.acknowledge_commerce_seo_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation integer;
begin
  if auth.uid() is null or public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select generation into v_generation
  from public.commerce_seo_alerts
  where id=p_alert_id and status='OPEN';

  if v_generation is null then
    return;
  end if;

  insert into public.commerce_seo_alert_receipts(alert_id,generation,user_id,acknowledged_at)
  values (p_alert_id,v_generation,auth.uid(),now())
  on conflict(alert_id,generation,user_id)
  do update set acknowledged_at=excluded.acknowledged_at;
end;
$$;

revoke all on function public.acknowledge_commerce_seo_alert(uuid) from public,anon;
grant execute on function public.acknowledge_commerce_seo_alert(uuid) to authenticated,service_role;

create or replace function public.acknowledge_all_commerce_seo_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or public.current_user_role() not in ('owner','admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.commerce_seo_alert_receipts(alert_id,generation,user_id,acknowledged_at)
  select a.id,a.generation,auth.uid(),now()
  from public.commerce_seo_alerts a
  where a.status='OPEN'
  on conflict(alert_id,generation,user_id) do update
    set acknowledged_at=excluded.acknowledged_at;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.acknowledge_all_commerce_seo_alerts() from public,anon;
grant execute on function public.acknowledge_all_commerce_seo_alerts() to authenticated,service_role;

create or replace function private.refresh_commerce_seo_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  create temporary table if not exists pg_temp.seo_alert_candidates (
    dedupe_key text primary key,
    alert_type text,
    severity text,
    action_id uuid,
    execution_id uuid,
    source_id uuid,
    primary_query text,
    page text,
    title text,
    message text,
    metadata jsonb
  ) on commit drop;

  truncate pg_temp.seo_alert_candidates;

  -- Executor failures.
  insert into pg_temp.seo_alert_candidates
  select
    'executor:'||j.id::text,
    'EXECUTOR_FAILED',
    'CRITICAL',
    j.action_id,
    e.id,
    j.id,
    q.primary_query,
    q.page,
    'SEO Executor ล้มเหลว',
    coalesce(j.last_error,j.reason,'Executor failed and needs review.'),
    jsonb_build_object('jobStatus',j.status,'riskMode',j.risk_mode,'attempts',j.attempts)
  from public.commerce_gsc_executor_jobs j
  join public.commerce_gsc_action_queue q on q.id=j.action_id
  left join public.commerce_gsc_action_executions e on e.executor_job_id=j.id
  where j.status='FAILED';

  -- Rollback failure/block.
  insert into pg_temp.seo_alert_candidates
  select
    'rollback:'||r.id::text,
    'ROLLBACK_PROBLEM',
    'CRITICAL',
    r.action_id,
    r.execution_id,
    r.id,
    q.primary_query,
    q.page,
    case when r.status='FAILED' then 'Auto Rollback ล้มเหลว' else 'Auto Rollback ถูก Block' end,
    coalesce(r.last_error,r.reason,'Rollback needs human review.'),
    jsonb_build_object('rollbackStatus',r.status,'attempts',r.attempts)
  from public.commerce_gsc_rollback_jobs r
  join public.commerce_gsc_action_queue q on q.id=r.action_id
  where r.status in ('FAILED','BLOCKED');

  -- Latest local measurement context.
  with latest as (
    select distinct on (m.execution_id)
      m.*,e.action_id,e.rollback_status,q.primary_query,q.page
    from public.commerce_gsc_action_measurements m
    join public.commerce_gsc_action_executions e on e.id=m.execution_id
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    order by m.execution_id,m.checkpoint_days desc,m.measured_at desc
  )
  insert into pg_temp.seo_alert_candidates
  select
    'regressed:'||l.execution_id::text,
    'REGRESSED',
    'CRITICAL',
    l.action_id,l.execution_id,l.id,l.primary_query,l.page,
    'SEO REGRESSED — Auto Rollback ต้องติดตาม',
    'Checkpoint '||l.checkpoint_days||'D ผ่าน Integrity และพบผล REGRESSED. '||
      case when l.rollback_status='NONE' then 'กำลังรอสร้าง Rollback job.'
           else 'Rollback status: '||l.rollback_status||'.' end,
    jsonb_build_object(
      'checkpointDays',l.checkpoint_days,
      'positionDelta',l.position_delta,
      'ctrDelta',l.ctr_delta,
      'rollbackStatus',l.rollback_status
    )
  from latest l
  where l.verdict='REGRESSED'
    and l.integrity_status='PASS'
    and l.rollback_recommended
    and l.rollback_status<>'ROLLED_BACK';

  with latest as (
    select distinct on (m.execution_id)
      m.*,e.action_id,q.primary_query,q.page
    from public.commerce_gsc_action_measurements m
    join public.commerce_gsc_action_executions e on e.id=m.execution_id
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    order by m.execution_id,m.checkpoint_days desc,m.measured_at desc
  )
  insert into pg_temp.seo_alert_candidates
  select
    'contaminated:'||l.execution_id::text,
    'CAUSAL_CONTAMINATION',
    'WARNING',
    l.action_id,l.execution_id,l.id,l.primary_query,l.page,
    'Measurement ถูก Causal Guard บล็อก',
    coalesce(l.causal_reason,'มี Production change อื่นซ้อนช่วง Experiment จึงห้ามสรุปเหตุและผล.'),
    jsonb_build_object(
      'checkpointDays',l.checkpoint_days,
      'contaminatingCommitCount',l.contaminating_commit_count,
      'contaminatingCommits',l.contaminating_commits
    )
  from latest l
  where l.verdict='CONTAMINATED';

  with latest as (
    select distinct on (m.execution_id)
      m.*,e.action_id,q.primary_query,q.page
    from public.commerce_gsc_action_measurements m
    join public.commerce_gsc_action_executions e on e.id=m.execution_id
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    order by m.execution_id,m.checkpoint_days desc,m.measured_at desc
  )
  insert into pg_temp.seo_alert_candidates
  select
    'volatility:'||l.execution_id::text,
    'SITEWIDE_VOLATILITY',
    'WARNING',
    l.action_id,l.execution_id,l.id,l.primary_query,l.page,
    'พบ Sitewide SEO Volatility',
    coalesce(l.volatility_reason,'อันดับหลายหน้าเปลี่ยนพร้อมกัน จึงยังไม่ผูกผลกับ Experiment นี้.'),
    jsonb_build_object(
      'checkpointDays',l.checkpoint_days,
      'peerCount',l.volatility_peer_count,
      'medianPositionDelta',l.volatility_median_position_delta
    )
  from latest l
  where l.verdict='EXTERNAL_SHIFT';

  -- Failed final recovery or recovery hard stop.
  with latest as (
    select distinct on (r.execution_id)
      r.*,e.action_id,e.recovery_status,q.primary_query,q.page
    from public.commerce_gsc_rollback_recovery_measurements r
    join public.commerce_gsc_action_executions e on e.id=r.execution_id
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    order by r.execution_id,r.checkpoint_days desc,r.measured_at desc
  )
  insert into pg_temp.seo_alert_candidates
  select
    'recovery-failed:'||l.execution_id::text,
    'RECOVERY_FAILED',
    'CRITICAL',
    l.action_id,l.execution_id,l.id,l.primary_query,l.page,
    'Rollback แล้วอันดับยังไม่ฟื้น',
    'Recovery '||l.checkpoint_days||'D = '||l.verdict||
      '. ต้อง Human Review ก่อนแก้ SEO รอบใหม่.',
    jsonb_build_object(
      'checkpointDays',l.checkpoint_days,
      'maturity',l.maturity,
      'verdict',l.verdict,
      'positionDeltaVsBaseline',l.position_delta_vs_baseline,
      'positionDeltaVsTrigger',l.position_delta_vs_trigger
    )
  from latest l
  where l.checkpoint_days=28
    and l.integrity_status='PASS'
    and l.verdict in ('NOT_RECOVERED','FURTHER_REGRESSED');

  insert into pg_temp.seo_alert_candidates
  select
    'recovery-blocked:'||e.id::text,
    'RECOVERY_BLOCKED',
    'WARNING',
    e.action_id,e.id,e.id,q.primary_query,q.page,
    'Recovery Measurement ถูกหยุดเพื่อ Human Review',
    coalesce(e.rollback_review_reason,'Recovery hard-stop reached without valid evidence.'),
    jsonb_build_object('recoveryStatus',e.recovery_status,'finalVerdict',e.recovery_final_verdict)
  from public.commerce_gsc_action_executions e
  join public.commerce_gsc_action_queue q on q.id=e.action_id
  where e.recovery_status='BLOCKED';

  -- Measurement checkpoint overdue: allow 2-day grace after 7/14 and 2-day grace after 28.
  with state as (
    select
      e.id execution_id,e.action_id,e.applied_at,q.primary_query,q.page,
      case
        when not exists (
          select 1 from public.commerce_gsc_action_measurements m
          where m.execution_id=e.id and m.checkpoint_days=7 and m.verdict<>'INSUFFICIENT_DATA'
        ) then 7
        when not exists (
          select 1 from public.commerce_gsc_action_measurements m
          where m.execution_id=e.id and m.checkpoint_days=14 and m.verdict<>'INSUFFICIENT_DATA'
        ) then 14
        when not exists (
          select 1 from public.commerce_gsc_action_measurements m
          where m.execution_id=e.id and m.checkpoint_days=28 and m.verdict<>'INSUFFICIENT_DATA'
        ) then 28
        else null
      end checkpoint_days
    from public.commerce_gsc_action_executions e
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    where e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
      and e.rollback_status<>'ROLLED_BACK'
  )
  insert into pg_temp.seo_alert_candidates
  select
    'experiment-overdue:'||s.execution_id::text||':'||s.checkpoint_days::text,
    'EXPERIMENT_OVERDUE',
    'WARNING',
    s.action_id,s.execution_id,s.execution_id,s.primary_query,s.page,
    'SEO Measurement '||s.checkpoint_days||'D เกินกำหนด',
    'เลย checkpoint '||s.checkpoint_days||
      'D มากกว่า 2 วันแล้วยังไม่มี verdict ที่ใช้งานได้. ตรวจ GSC freshness / Integrity Guard.',
    jsonb_build_object(
      'checkpointDays',s.checkpoint_days,
      'dueAt',s.applied_at+make_interval(days=>s.checkpoint_days)
    )
  from state s
  where s.checkpoint_days is not null
    and now() > s.applied_at + make_interval(days=>s.checkpoint_days+2);

  with state as (
    select
      e.id execution_id,e.action_id,e.rolled_back_at,q.primary_query,q.page,
      case
        when not exists (
          select 1 from public.commerce_gsc_rollback_recovery_measurements r
          where r.execution_id=e.id and r.checkpoint_days=7 and r.verdict<>'INSUFFICIENT_DATA'
        ) then 7
        when not exists (
          select 1 from public.commerce_gsc_rollback_recovery_measurements r
          where r.execution_id=e.id and r.checkpoint_days=14 and r.verdict<>'INSUFFICIENT_DATA'
        ) then 14
        when not exists (
          select 1 from public.commerce_gsc_rollback_recovery_measurements r
          where r.execution_id=e.id and r.checkpoint_days=28 and r.verdict<>'INSUFFICIENT_DATA'
        ) then 28
        else null
      end checkpoint_days
    from public.commerce_gsc_action_executions e
    join public.commerce_gsc_action_queue q on q.id=e.action_id
    where e.recovery_status='MONITORING'
      and e.rolled_back_at is not null
  )
  insert into pg_temp.seo_alert_candidates
  select
    'recovery-overdue:'||s.execution_id::text||':'||s.checkpoint_days::text,
    'RECOVERY_OVERDUE',
    'WARNING',
    s.action_id,s.execution_id,s.execution_id,s.primary_query,s.page,
    'Recovery Measurement '||s.checkpoint_days||'D เกินกำหนด',
    'เลย Recovery checkpoint '||s.checkpoint_days||
      'D มากกว่า 2 วันแล้วยังไม่มี verdict ที่ใช้งานได้.',
    jsonb_build_object(
      'checkpointDays',s.checkpoint_days,
      'dueAt',s.rolled_back_at+make_interval(days=>s.checkpoint_days)
    )
  from state s
  where s.checkpoint_days is not null
    and now() > s.rolled_back_at + make_interval(days=>s.checkpoint_days+2);

  -- Re-open/upsert active alerts. Reopening increments generation so acknowledgements do not hide a new occurrence.
  insert into public.commerce_seo_alerts(
    dedupe_key,alert_type,severity,status,generation,
    action_id,execution_id,source_id,primary_query,page,
    title,message,metadata,first_seen_at,last_seen_at,resolved_at,updated_at
  )
  select
    c.dedupe_key,c.alert_type,c.severity,'OPEN',1,
    c.action_id,c.execution_id,c.source_id,c.primary_query,c.page,
    c.title,c.message,c.metadata,now(),now(),null,now()
  from pg_temp.seo_alert_candidates c
  on conflict(dedupe_key) do update set
    alert_type=excluded.alert_type,
    severity=excluded.severity,
    status='OPEN',
    generation=case
      when public.commerce_seo_alerts.status='RESOLVED'
        then public.commerce_seo_alerts.generation+1
      else public.commerce_seo_alerts.generation
    end,
    action_id=excluded.action_id,
    execution_id=excluded.execution_id,
    source_id=excluded.source_id,
    primary_query=excluded.primary_query,
    page=excluded.page,
    title=excluded.title,
    message=excluded.message,
    metadata=excluded.metadata,
    first_seen_at=case
      when public.commerce_seo_alerts.status='RESOLVED' then now()
      else public.commerce_seo_alerts.first_seen_at
    end,
    last_seen_at=now(),
    resolved_at=null,
    updated_at=now();

  -- Resolve managed alerts whose condition is no longer active.
  update public.commerce_seo_alerts a
  set status='RESOLVED',resolved_at=now(),updated_at=now()
  where a.status='OPEN'
    and not exists (
      select 1 from pg_temp.seo_alert_candidates c where c.dedupe_key=a.dedupe_key
    );
end;
$$;

revoke all on function private.refresh_commerce_seo_alerts() from public,anon,authenticated;
grant execute on function private.refresh_commerce_seo_alerts() to service_role;

select private.refresh_commerce_seo_alerts();

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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_gsc_prior_selector(); select private.capture_gsc_sitewide_query_snapshots(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements(); select private.refresh_gsc_rollback_recovery_measurements(); select private.refresh_gsc_learning_ledger(); select private.refresh_gsc_learning_prior_snapshots(); select private.refresh_gsc_prior_selector(); select private.refresh_gsc_executor_guards(); select private.refresh_commerce_seo_alerts();'
);

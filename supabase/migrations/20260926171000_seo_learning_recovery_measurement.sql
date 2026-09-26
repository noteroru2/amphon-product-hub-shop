-- SEO Learning Ledger + post-rollback Recovery Measurement
-- Learns only from integrity-passing evidence. A rollback opens a recovery observation lock
-- so the same URL is not mutated while we test whether rankings recover.

alter table public.commerce_gsc_executor_policy
  add column if not exists recovery_hard_stop_days integer not null default 35
    check (recovery_hard_stop_days between 28 and 60);

update public.commerce_gsc_executor_policy
set recovery_hard_stop_days=35, updated_at=now()
where repository='noteroru2/amphon.co.th';

alter table public.commerce_gsc_action_executions
  add column if not exists recovery_status text not null default 'NONE'
    check (recovery_status in ('NONE','MONITORING','COMPLETE','BLOCKED')),
  add column if not exists recovery_last_measured_at timestamptz,
  add column if not exists recovery_final_verdict text
    check (recovery_final_verdict is null or recovery_final_verdict in (
      'RECOVERED','PARTIAL_RECOVERY','NOT_RECOVERED','FURTHER_REGRESSED','INSUFFICIENT_DATA'
    )),
  add column if not exists recovery_complete_at timestamptz,
  add column if not exists recovery_lock_until timestamptz;

-- Recovery observation is also an experiment lock. This prevents a new mutation from
-- contaminating the causal read after an automatic rollback.
drop index if exists public.commerce_gsc_active_page_experiment_uidx;
create unique index commerce_gsc_active_page_experiment_uidx
  on public.commerce_gsc_action_executions(repository,live_url)
  where repository is not null
    and live_url is not null
    and (
      (monitor_status in ('MONITORING','ROLLBACK_REVIEW') and rollback_status <> 'ROLLED_BACK')
      or recovery_status='MONITORING'
    );

create table if not exists public.commerce_gsc_rollback_recovery_measurements (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.commerce_gsc_action_executions(id) on delete cascade,
  checkpoint_days integer not null check (checkpoint_days in (7,14,28)),
  maturity text not null check (maturity in ('EARLY','PROVISIONAL','FINAL')),
  measured_at timestamptz not null default now(),
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  position_delta_vs_baseline numeric not null default 0,
  ctr_delta_vs_baseline numeric not null default 0,
  position_delta_vs_trigger numeric not null default 0,
  ctr_delta_vs_trigger numeric not null default 0,
  current_query_share numeric,
  query_share_shift numeric,
  traffic_ratio numeric,
  data_age_hours numeric,
  post_rollback_exposure_days numeric,
  window_purity numeric not null default 0 check (window_purity between 0 and 1),
  integrity_status text not null check (integrity_status in ('PASS','BLOCKED')),
  integrity_codes text[] not null default '{}'::text[],
  integrity_reason text,
  verdict text not null check (verdict in (
    'RECOVERED','PARTIAL_RECOVERY','NOT_RECOVERED','FURTHER_REGRESSED','INSUFFICIENT_DATA'
  )),
  source_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique(execution_id,checkpoint_days)
);

create index if not exists commerce_gsc_rollback_recovery_measurements_execution_idx
  on public.commerce_gsc_rollback_recovery_measurements(execution_id,checkpoint_days);

alter table public.commerce_gsc_rollback_recovery_measurements enable row level security;
drop policy if exists commerce_gsc_rollback_recovery_measurements_read_admin
  on public.commerce_gsc_rollback_recovery_measurements;
create policy commerce_gsc_rollback_recovery_measurements_read_admin
on public.commerce_gsc_rollback_recovery_measurements
for select to authenticated
using (
  public.current_user_role() in ('owner','admin')
  and exists (
    select 1
    from public.commerce_gsc_action_executions e
    where e.id=execution_id
  )
);

revoke all on public.commerce_gsc_rollback_recovery_measurements from anon;
revoke insert,update,delete on public.commerce_gsc_rollback_recovery_measurements from authenticated;
grant select on public.commerce_gsc_rollback_recovery_measurements to authenticated;
grant select,insert,update,delete on public.commerce_gsc_rollback_recovery_measurements to service_role;

create table if not exists public.commerce_gsc_learning_ledger (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null unique references public.commerce_gsc_action_executions(id) on delete cascade,
  action_id uuid not null references public.commerce_gsc_action_queue(id) on delete cascade,
  repository text,
  page text not null,
  primary_query text not null,
  action_type text not null,
  opportunity_type text not null,
  execution_kind text not null,
  risk_mode text,
  applied_at timestamptz not null,
  diff_sha256 text,
  patch_payload jsonb not null default '{}'::jsonb,

  baseline_query_impressions numeric,
  baseline_query_ctr numeric,
  baseline_query_position numeric,

  latest_action_checkpoint_days integer,
  latest_action_verdict text,
  latest_action_integrity_status text,
  action_position_delta numeric,
  action_ctr_delta numeric,

  rollback_triggered boolean not null default false,
  rollback_trigger_checkpoint_days integer,
  rolled_back_at timestamptz,

  latest_recovery_checkpoint_days integer,
  latest_recovery_verdict text,
  latest_recovery_maturity text,
  recovery_position_delta_vs_trigger numeric,
  recovery_position_delta_vs_baseline numeric,
  recovery_ctr_delta_vs_trigger numeric,
  recovery_ctr_delta_vs_baseline numeric,

  learning_signal text not null default 'PENDING'
    check (learning_signal in (
      'PENDING','BENEFIT_CONFIRMED','HARM_CONFIRMED','HARM_LIKELY',
      'HARM_UNCONFIRMED','NO_CLEAR_EFFECT','INSUFFICIENT'
    )),
  confidence text not null default 'PENDING'
    check (confidence in ('PENDING','LOW','MEDIUM','HIGH','INSUFFICIENT')),
  evidence_count integer not null default 0,
  confidence_weight numeric not null default 0,
  signal_weight numeric not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists commerce_gsc_learning_ledger_signal_idx
  on public.commerce_gsc_learning_ledger(repository,action_type,learning_signal,confidence,updated_at desc);

alter table public.commerce_gsc_learning_ledger enable row level security;
drop policy if exists commerce_gsc_learning_ledger_read_admin on public.commerce_gsc_learning_ledger;
create policy commerce_gsc_learning_ledger_read_admin
on public.commerce_gsc_learning_ledger
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_learning_ledger from anon;
revoke insert,update,delete on public.commerce_gsc_learning_ledger from authenticated;
grant select on public.commerce_gsc_learning_ledger to authenticated;
grant select,insert,update,delete on public.commerce_gsc_learning_ledger to service_role;

create or replace function private.refresh_gsc_learning_ledger()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commerce_gsc_learning_ledger(
    execution_id,action_id,repository,page,primary_query,action_type,opportunity_type,
    execution_kind,risk_mode,applied_at,diff_sha256,patch_payload,
    baseline_query_impressions,baseline_query_ctr,baseline_query_position,
    latest_action_checkpoint_days,latest_action_verdict,latest_action_integrity_status,
    action_position_delta,action_ctr_delta,
    rollback_triggered,rollback_trigger_checkpoint_days,rolled_back_at,
    latest_recovery_checkpoint_days,latest_recovery_verdict,latest_recovery_maturity,
    recovery_position_delta_vs_trigger,recovery_position_delta_vs_baseline,
    recovery_ctr_delta_vs_trigger,recovery_ctr_delta_vs_baseline,
    learning_signal,confidence,evidence_count,confidence_weight,signal_weight,updated_at
  )
  with raw as (
    select
      e.id execution_id,
      e.action_id,
      e.repository,
      coalesce(e.live_url,a.page) page,
      a.primary_query,
      a.action_type,
      a.opportunity_type,
      e.execution_kind,
      e.risk_mode,
      e.applied_at,
      e.diff_sha256,
      coalesce(j.patch_payload,'{}'::jsonb) patch_payload,
      e.baseline_query_impressions,
      e.baseline_query_ctr,
      e.baseline_query_position,
      e.rollback_status,
      e.rollback_trigger_measurement_id,
      e.rolled_back_at,
      e.recovery_status,

      coalesce(tm.checkpoint_days,lam.checkpoint_days) latest_action_checkpoint_days,
      coalesce(tm.verdict,lam.verdict) latest_action_verdict,
      coalesce(tm.integrity_status,lam.integrity_status) latest_action_integrity_status,
      coalesce(tm.position_delta,lam.position_delta) action_position_delta,
      coalesce(tm.ctr_delta,lam.ctr_delta) action_ctr_delta,

      tm.checkpoint_days rollback_trigger_checkpoint_days,

      lrm.checkpoint_days latest_recovery_checkpoint_days,
      lrm.verdict latest_recovery_verdict,
      lrm.maturity latest_recovery_maturity,
      lrm.position_delta_vs_trigger recovery_position_delta_vs_trigger,
      lrm.position_delta_vs_baseline recovery_position_delta_vs_baseline,
      lrm.ctr_delta_vs_trigger recovery_ctr_delta_vs_trigger,
      lrm.ctr_delta_vs_baseline recovery_ctr_delta_vs_baseline,

      fam.verdict final_action_verdict,
      frm.verdict final_recovery_verdict,

      (
        select count(*)::int
        from public.commerce_gsc_action_measurements am
        where am.execution_id=e.id and am.integrity_status='PASS'
      )
      +
      (
        select count(*)::int
        from public.commerce_gsc_rollback_recovery_measurements rm
        where rm.execution_id=e.id and rm.integrity_status='PASS'
      ) evidence_count
    from public.commerce_gsc_action_executions e
    join public.commerce_gsc_action_queue a on a.id=e.action_id
    left join public.commerce_gsc_executor_jobs j on j.id=e.executor_job_id
    left join public.commerce_gsc_action_measurements tm
      on tm.id=e.rollback_trigger_measurement_id
     and tm.integrity_status='PASS'
    left join lateral (
      select m.*
      from public.commerce_gsc_action_measurements m
      where m.execution_id=e.id and m.integrity_status='PASS'
      order by m.checkpoint_days desc,m.measured_at desc
      limit 1
    ) lam on true
    left join lateral (
      select m.*
      from public.commerce_gsc_action_measurements m
      where m.execution_id=e.id
        and m.checkpoint_days=28
        and m.integrity_status='PASS'
      order by m.measured_at desc
      limit 1
    ) fam on true
    left join lateral (
      select r.*
      from public.commerce_gsc_rollback_recovery_measurements r
      where r.execution_id=e.id and r.integrity_status='PASS'
      order by r.checkpoint_days desc,r.measured_at desc
      limit 1
    ) lrm on true
    left join lateral (
      select r.*
      from public.commerce_gsc_rollback_recovery_measurements r
      where r.execution_id=e.id
        and r.checkpoint_days=28
        and r.integrity_status='PASS'
      order by r.measured_at desc
      limit 1
    ) frm on true
  ),
  classified as (
    select
      r.*,
      case
        when r.baseline_query_position is null or r.baseline_query_impressions is null then 'INSUFFICIENT'
        when r.rollback_status='ROLLED_BACK' then
          case
            when r.final_recovery_verdict='RECOVERED' then 'HARM_CONFIRMED'
            when r.final_recovery_verdict='PARTIAL_RECOVERY' then 'HARM_LIKELY'
            when r.final_recovery_verdict in ('NOT_RECOVERED','FURTHER_REGRESSED') then 'HARM_UNCONFIRMED'
            when r.recovery_status='BLOCKED' then 'INSUFFICIENT'
            else 'PENDING'
          end
        when r.final_action_verdict='IMPROVED' then 'BENEFIT_CONFIRMED'
        when r.final_action_verdict='NEUTRAL' then 'NO_CLEAR_EFFECT'
        when r.final_action_verdict='REGRESSED' then 'HARM_LIKELY'
        else 'PENDING'
      end learning_signal,
      case
        when r.baseline_query_position is null or r.baseline_query_impressions is null then 'INSUFFICIENT'
        when r.final_recovery_verdict is not null or r.final_action_verdict is not null then 'HIGH'
        when coalesce(r.latest_recovery_checkpoint_days,r.latest_action_checkpoint_days,0) >= 14 then 'MEDIUM'
        when coalesce(r.latest_recovery_checkpoint_days,r.latest_action_checkpoint_days,0) >= 7 then 'LOW'
        when r.recovery_status='BLOCKED' then 'INSUFFICIENT'
        else 'PENDING'
      end confidence
    from raw r
  ),
  weighted as (
    select
      c.*,
      case c.confidence
        when 'HIGH' then 1.0
        when 'MEDIUM' then 0.6
        when 'LOW' then 0.3
        else 0
      end::numeric confidence_weight,
      case c.learning_signal
        when 'BENEFIT_CONFIRMED' then 1.0
        when 'HARM_CONFIRMED' then -1.0
        when 'HARM_LIKELY' then -0.70
        when 'HARM_UNCONFIRMED' then -0.25
        when 'NO_CLEAR_EFFECT' then 0
        else 0
      end::numeric signal_weight
    from classified c
  )
  select
    w.execution_id,w.action_id,w.repository,w.page,w.primary_query,w.action_type,w.opportunity_type,
    w.execution_kind,w.risk_mode,w.applied_at,w.diff_sha256,w.patch_payload,
    w.baseline_query_impressions,w.baseline_query_ctr,w.baseline_query_position,
    w.latest_action_checkpoint_days,w.latest_action_verdict,w.latest_action_integrity_status,
    w.action_position_delta,w.action_ctr_delta,
    (w.rollback_status='ROLLED_BACK'),w.rollback_trigger_checkpoint_days,w.rolled_back_at,
    w.latest_recovery_checkpoint_days,w.latest_recovery_verdict,w.latest_recovery_maturity,
    w.recovery_position_delta_vs_trigger,w.recovery_position_delta_vs_baseline,
    w.recovery_ctr_delta_vs_trigger,w.recovery_ctr_delta_vs_baseline,
    w.learning_signal,w.confidence,w.evidence_count,w.confidence_weight,w.signal_weight,now()
  from weighted w
  on conflict (execution_id) do update set
    action_id=excluded.action_id,
    repository=excluded.repository,
    page=excluded.page,
    primary_query=excluded.primary_query,
    action_type=excluded.action_type,
    opportunity_type=excluded.opportunity_type,
    execution_kind=excluded.execution_kind,
    risk_mode=excluded.risk_mode,
    applied_at=excluded.applied_at,
    diff_sha256=excluded.diff_sha256,
    patch_payload=excluded.patch_payload,
    baseline_query_impressions=excluded.baseline_query_impressions,
    baseline_query_ctr=excluded.baseline_query_ctr,
    baseline_query_position=excluded.baseline_query_position,
    latest_action_checkpoint_days=excluded.latest_action_checkpoint_days,
    latest_action_verdict=excluded.latest_action_verdict,
    latest_action_integrity_status=excluded.latest_action_integrity_status,
    action_position_delta=excluded.action_position_delta,
    action_ctr_delta=excluded.action_ctr_delta,
    rollback_triggered=excluded.rollback_triggered,
    rollback_trigger_checkpoint_days=excluded.rollback_trigger_checkpoint_days,
    rolled_back_at=excluded.rolled_back_at,
    latest_recovery_checkpoint_days=excluded.latest_recovery_checkpoint_days,
    latest_recovery_verdict=excluded.latest_recovery_verdict,
    latest_recovery_maturity=excluded.latest_recovery_maturity,
    recovery_position_delta_vs_trigger=excluded.recovery_position_delta_vs_trigger,
    recovery_position_delta_vs_baseline=excluded.recovery_position_delta_vs_baseline,
    recovery_ctr_delta_vs_trigger=excluded.recovery_ctr_delta_vs_trigger,
    recovery_ctr_delta_vs_baseline=excluded.recovery_ctr_delta_vs_baseline,
    learning_signal=excluded.learning_signal,
    confidence=excluded.confidence,
    evidence_count=excluded.evidence_count,
    confidence_weight=excluded.confidence_weight,
    signal_weight=excluded.signal_weight,
    updated_at=now();
end;
$$;

revoke all on function private.refresh_gsc_learning_ledger() from public,anon,authenticated;
grant execute on function private.refresh_gsc_learning_ledger() to service_role;

create or replace view public.commerce_gsc_learning_summary_v
with (security_invoker=true)
as
select
  repository,
  action_type,
  opportunity_type,
  count(*)::int as experiments,
  count(*) filter(where confidence='HIGH')::int as high_confidence_experiments,
  count(*) filter(where learning_signal='BENEFIT_CONFIRMED')::int as benefit_confirmed,
  count(*) filter(where learning_signal='HARM_CONFIRMED')::int as harm_confirmed,
  count(*) filter(where learning_signal='HARM_LIKELY')::int as harm_likely,
  count(*) filter(where learning_signal='HARM_UNCONFIRMED')::int as harm_unconfirmed,
  count(*) filter(where learning_signal='NO_CLEAR_EFFECT')::int as no_clear_effect,
  count(*) filter(where learning_signal in ('PENDING','INSUFFICIENT'))::int as pending_or_insufficient,
  case
    when sum(confidence_weight)>0
      then sum(signal_weight*confidence_weight)/sum(confidence_weight)
    else 0
  end::numeric as learning_score,
  avg(action_position_delta) filter(where latest_action_integrity_status='PASS') as avg_position_delta,
  avg(action_ctr_delta) filter(where latest_action_integrity_status='PASS') as avg_ctr_delta,
  max(updated_at) as updated_at
from public.commerce_gsc_learning_ledger
group by repository,action_type,opportunity_type;

grant select on public.commerce_gsc_learning_summary_v to authenticated,service_role;

create or replace function private.refresh_gsc_rollback_recovery_measurements()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  m public.commerce_gsc_action_measurements;
  v_checkpoint integer;
  v_maturity text;
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
  v_exposure_days numeric;
  v_window_purity numeric;
  v_min_impressions integer;
  v_max_data_age_hours integer;
  v_max_query_share_shift numeric;
  v_min_traffic_ratio numeric;
  v_max_traffic_ratio numeric;
  v_codes text[];
  v_integrity text;
  v_integrity_reason text;
  v_verdict text;
begin
  for e in
    select
      x.*,
      a.property,a.page,a.primary_query,a.action_type
    from public.commerce_gsc_action_executions x
    join public.commerce_gsc_action_queue a on a.id=x.action_id
    where x.rollback_status='ROLLED_BACK'
      and x.recovery_status='MONITORING'
      and x.rolled_back_at is not null
      and x.rolled_back_at <= now()-interval '7 days'
    order by x.rolled_back_at
  loop
    v_checkpoint := null;

    if e.rolled_back_at <= now()-interval '28 days'
       and (
         not exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=28
         )
         or exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=28
             and r.verdict='INSUFFICIENT_DATA'
             and r.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 28;
      v_maturity := 'FINAL';
    elsif e.rolled_back_at <= now()-interval '14 days'
       and (
         not exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=14
         )
         or exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=14
             and r.verdict='INSUFFICIENT_DATA'
             and r.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 14;
      v_maturity := 'PROVISIONAL';
    elsif e.rolled_back_at <= now()-interval '7 days'
       and (
         not exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=7
         )
         or exists(
           select 1 from public.commerce_gsc_rollback_recovery_measurements r
           where r.execution_id=e.id and r.checkpoint_days=7
             and r.verdict='INSUFFICIENT_DATA'
             and r.measured_at <= now()-interval '12 hours'
         )
       ) then
      v_checkpoint := 7;
      v_maturity := 'EARLY';
    end if;

    if v_checkpoint is null then
      continue;
    end if;

    select * into m
    from public.commerce_gsc_action_measurements
    where id=e.rollback_trigger_measurement_id;

    select
      coalesce(max(p.measurement_min_impressions),20),
      coalesce(max(p.measurement_max_data_age_hours),48),
      coalesce(max(p.measurement_max_query_share_shift),0.30),
      coalesce(max(p.measurement_min_traffic_ratio),0.35),
      coalesce(max(p.measurement_max_traffic_ratio),2.85)
    into
      v_min_impressions,v_max_data_age_hours,v_max_query_share_shift,
      v_min_traffic_ratio,v_max_traffic_ratio
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
      when coalesce(v_page_impressions,0)>0 and v_impressions is not null
        then v_impressions/v_page_impressions
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
    v_exposure_days := case when v_fetched is not null
      then extract(epoch from (v_fetched-e.rolled_back_at))/86400.0 else null end;
    v_window_purity := least(1::numeric,greatest(0::numeric,coalesce(v_exposure_days,0)/28.0));

    v_codes := '{}'::text[];

    if e.baseline_query_position is null
       or e.baseline_query_ctr is null
       or e.baseline_query_impressions is null
       or e.baseline_query_fetched_at is null then
      v_codes := array_append(v_codes,'NO_ALIGNED_BASELINE');
    end if;

    if m.id is null or m.integrity_status<>'PASS' or m.verdict<>'REGRESSED' then
      v_codes := array_append(v_codes,'NO_VALID_REGRESSION_TRIGGER');
    end if;

    if v_fetched is null or v_impressions is null then
      v_codes := array_append(v_codes,'NO_CURRENT_QUERY');
    else
      if v_data_age_hours > v_max_data_age_hours then
        v_codes := array_append(v_codes,'STALE_SOURCE');
      end if;
      if v_exposure_days < greatest(1,v_checkpoint-2) then
        v_codes := array_append(v_codes,'LOW_POST_ROLLBACK_EXPOSURE');
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
        'Recovery Integrity PASS: valid regression trigger, aligned baseline/current primary-query snapshot, fresh source, sufficient sample and stable traffic/query mix.'
      else
        'Recovery Integrity BLOCKED: '||array_to_string(v_codes,', ')||'. Learning Ledger will not treat this checkpoint as causal evidence.'
    end;

    if v_integrity='BLOCKED' then
      v_verdict := 'INSUFFICIENT_DATA';
    elsif
      (
        v_position <= e.baseline_query_position + 0.75
        and (
          e.baseline_query_ctr=0
          or v_ctr >= e.baseline_query_ctr*0.80
        )
      )
      or (
        e.baseline_query_ctr>0
        and v_ctr >= e.baseline_query_ctr*0.90
        and v_position <= e.baseline_query_position + 1.0
      )
    then
      v_verdict := 'RECOVERED';
    elsif
      (
        v_position >= m.position + 1.0
        and (m.ctr=0 or v_ctr <= m.ctr*1.10)
      )
      or (
        m.ctr>0
        and v_ctr <= m.ctr*0.75
        and v_position >= m.position - 0.25
      )
    then
      v_verdict := 'FURTHER_REGRESSED';
    elsif
      v_position <= m.position - 0.5
      or (
        m.ctr>0
        and v_ctr >= m.ctr*1.15
        and v_position <= m.position + 0.75
      )
    then
      v_verdict := 'PARTIAL_RECOVERY';
    else
      v_verdict := 'NOT_RECOVERED';
    end if;

    insert into public.commerce_gsc_rollback_recovery_measurements(
      execution_id,checkpoint_days,maturity,measured_at,
      clicks,impressions,ctr,position,
      position_delta_vs_baseline,ctr_delta_vs_baseline,
      position_delta_vs_trigger,ctr_delta_vs_trigger,
      current_query_share,query_share_shift,traffic_ratio,data_age_hours,
      post_rollback_exposure_days,window_purity,
      integrity_status,integrity_codes,integrity_reason,verdict,source_fetched_at
    ) values (
      e.id,v_checkpoint,v_maturity,now(),
      coalesce(v_clicks,0),coalesce(v_impressions,0),coalesce(v_ctr,0),coalesce(v_position,0),
      coalesce(v_position,0)-coalesce(e.baseline_query_position,0),
      coalesce(v_ctr,0)-coalesce(e.baseline_query_ctr,0),
      coalesce(v_position,0)-coalesce(m.position,0),
      coalesce(v_ctr,0)-coalesce(m.ctr,0),
      v_current_share,v_share_shift,v_traffic_ratio,v_data_age_hours,
      v_exposure_days,v_window_purity,
      v_integrity,v_codes,v_integrity_reason,v_verdict,v_fetched
    )
    on conflict (execution_id,checkpoint_days) do update set
      maturity=excluded.maturity,
      measured_at=excluded.measured_at,
      clicks=excluded.clicks,
      impressions=excluded.impressions,
      ctr=excluded.ctr,
      position=excluded.position,
      position_delta_vs_baseline=excluded.position_delta_vs_baseline,
      ctr_delta_vs_baseline=excluded.ctr_delta_vs_baseline,
      position_delta_vs_trigger=excluded.position_delta_vs_trigger,
      ctr_delta_vs_trigger=excluded.ctr_delta_vs_trigger,
      current_query_share=excluded.current_query_share,
      query_share_shift=excluded.query_share_shift,
      traffic_ratio=excluded.traffic_ratio,
      data_age_hours=excluded.data_age_hours,
      post_rollback_exposure_days=excluded.post_rollback_exposure_days,
      window_purity=excluded.window_purity,
      integrity_status=excluded.integrity_status,
      integrity_codes=excluded.integrity_codes,
      integrity_reason=excluded.integrity_reason,
      verdict=excluded.verdict,
      source_fetched_at=excluded.source_fetched_at
    where public.commerce_gsc_rollback_recovery_measurements.verdict='INSUFFICIENT_DATA';

    update public.commerce_gsc_action_executions
    set
      recovery_last_measured_at=now(),
      recovery_status=case
        when v_checkpoint=28 and v_verdict<>'INSUFFICIENT_DATA' then 'COMPLETE'
        else recovery_status
      end,
      recovery_final_verdict=case
        when v_checkpoint=28 and v_verdict<>'INSUFFICIENT_DATA' then v_verdict
        else recovery_final_verdict
      end,
      recovery_complete_at=case
        when v_checkpoint=28 and v_verdict<>'INSUFFICIENT_DATA' then now()
        else recovery_complete_at
      end,
      recovery_lock_until=case
        when v_checkpoint=28 and v_verdict<>'INSUFFICIENT_DATA' then null
        else recovery_lock_until
      end
    where id=e.id;
  end loop;

  -- Fail safe: do not lock a URL forever if GSC never becomes usable.
  update public.commerce_gsc_action_executions e
  set
    recovery_status='BLOCKED',
    recovery_final_verdict='INSUFFICIENT_DATA',
    recovery_complete_at=now(),
    recovery_lock_until=null,
    rollback_review_reason=concat_ws(
      E'\n',
      e.rollback_review_reason,
      'Recovery Measurement hard-stop reached without a valid 28d checkpoint; released Page Experiment Lock for human review.'
    )
  where e.recovery_status='MONITORING'
    and e.rolled_back_at is not null
    and e.rolled_back_at <= now() - make_interval(
      days => coalesce(
        (select p.recovery_hard_stop_days
         from public.commerce_gsc_executor_policy p
         where p.repository=e.repository),
        35
      )
    )
    and not exists (
      select 1
      from public.commerce_gsc_rollback_recovery_measurements r
      where r.execution_id=e.id
        and r.checkpoint_days=28
        and r.integrity_status='PASS'
    );

  perform private.refresh_gsc_learning_ledger();
  perform private.refresh_gsc_executor_guards();
end;
$$;

revoke all on function private.refresh_gsc_rollback_recovery_measurements() from public,anon,authenticated;
grant execute on function private.refresh_gsc_rollback_recovery_measurements() to service_role;

-- Extend Page Experiment Lock through the post-rollback causal observation window.
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
      ) as active_action_count,

      (
        select count(*)::int
        from public.commerce_gsc_action_executions e
        where e.repository=j.target_repository
          and e.live_url=a.page
          and e.recovery_status='MONITORING'
          and (e.recovery_lock_until is null or e.recovery_lock_until>now())
      ) as active_recovery_count,

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
      ) as active_job_count,

      coalesce(
        (
          select e.id
          from public.commerce_gsc_action_executions e
          where e.repository=j.target_repository
            and e.live_url=a.page
            and e.recovery_status='MONITORING'
            and (e.recovery_lock_until is null or e.recovery_lock_until>now())
          order by e.rolled_back_at desc nulls last
          limit 1
        ),
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
        )
      ) as lock_execution_id,

      least(
        coalesce(
          (
            select min(e.applied_at + interval '28 days')
            from public.commerce_gsc_action_executions e
            where e.repository=j.target_repository
              and e.live_url=a.page
              and e.action_id<>j.action_id
              and e.monitor_status in ('MONITORING','ROLLBACK_REVIEW')
              and e.rollback_status<>'ROLLED_BACK'
          ),
          'infinity'::timestamptz
        ),
        coalesce(
          (
            select min(e.recovery_lock_until)
            from public.commerce_gsc_action_executions e
            where e.repository=j.target_repository
              and e.live_url=a.page
              and e.recovery_status='MONITORING'
              and (e.recovery_lock_until is null or e.recovery_lock_until>now())
          ),
          'infinity'::timestamptz
        )
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
      (b.active_action_count+b.active_recovery_count+b.active_job_count) as active_page_count,
      case
        when b.risk_mode='PROTECT' then 'PROTECTED'
        when b.risk_mode not in ('AUTO_DEPLOY','PR_ONLY') then 'RISK_GATE'
        when b.status in ('RUNNING','VERIFYING','PR_READY','APPLIED') then 'READY'
        when (b.active_action_count+b.active_recovery_count+b.active_job_count) >= b.page_limit
          then 'PAGE_EXPERIMENT_LOCK'
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
      when g.next_guard='PAGE_EXPERIMENT_LOCK' and g.active_recovery_count>0 then
        'Page Experiment Lock: this URL is in post-rollback Recovery Measurement. No new SEO mutation until recovery reaches a valid 28d checkpoint or the safety hard-stop.'
      when g.next_guard='PAGE_EXPERIMENT_LOCK' then
        'Page Experiment Lock: an active experiment already owns this URL. Wait for the current measurement cycle or rollback to finish.'
      when g.next_guard='ACTION_BUDGET' then
        'Action Budget: '||g.budget_used||'/'||g.budget_limit||' mutating SEO action slots are already used/reserved in the rolling 24h window.'
      else
        'Safety guards passed: page has no competing active experiment/recovery observation and action budget has capacity.'
    end,
    guard_checked_at=now(),
    next_eligible_at=case
      when g.next_guard='PAGE_EXPERIMENT_LOCK' and g.page_estimated_release<>'infinity'::timestamptz
        then g.page_estimated_release
      when g.next_guard='ACTION_BUDGET' then g.budget_release
      else null
    end,
    budget_used_24h=g.budget_used,
    budget_limit_24h=g.budget_limit,
    active_page_experiments=g.active_page_count,
    page_lock_execution_id=g.lock_execution_id,
    updated_at=case
      when j.guard_code is distinct from g.next_guard
        or j.guard_reason is distinct from case
          when g.next_guard='PROTECTED' then
            'PROTECT_PAGE is non-mutating; Title/H1/URL/Canonical remain locked.'
          when g.next_guard='RISK_GATE' then
            'Risk gate requires human review/observe mode; automatic mutation is not claimable.'
          when g.next_guard='PAGE_EXPERIMENT_LOCK' and g.active_recovery_count>0 then
            'Page Experiment Lock: this URL is in post-rollback Recovery Measurement. No new SEO mutation until recovery reaches a valid 28d checkpoint or the safety hard-stop.'
          when g.next_guard='PAGE_EXPERIMENT_LOCK' then
            'Page Experiment Lock: an active experiment already owns this URL. Wait for the current measurement cycle or rollback to finish.'
          when g.next_guard='ACTION_BUDGET' then
            'Action Budget: '||g.budget_used||'/'||g.budget_limit||' mutating SEO action slots are already used/reserved in the rolling 24h window.'
          else
            'Safety guards passed: page has no competing active experiment/recovery observation and action budget has capacity.'
        end
      then now()
      else j.updated_at
    end
  from guarded g
  where j.id=g.id;
end;
$$;

revoke all on function private.refresh_gsc_executor_guards() from public,anon,authenticated;
grant execute on function private.refresh_gsc_executor_guards() to service_role;

-- Rollback completion now opens a Recovery Measurement observation instead of ending the story.
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
  v_recovery_hard_stop_days integer;
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

  select coalesce(max(p.recovery_hard_stop_days),35)
  into v_recovery_hard_stop_days
  from public.commerce_gsc_executor_policy p
  where p.repository=r.repository;

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
    last_error=case
      when p_outcome in ('FAILED','BLOCKED')
        then coalesce(v_error,'Rollback stopped without an error message')
      else null
    end,
    lease_token=null,
    lease_expires_at=null,
    updated_at=now()
  where id=p_job_id
  returning * into r;

  update public.commerce_gsc_action_executions x
  set
    rollback_status=p_outcome,
    rollback_actual_commit_sha=v_revert_sha,
    rollback_actual_diff_sha256=v_diff_sha,
    rolled_back_at=case
      when p_outcome='ROLLED_BACK' then coalesce(x.rolled_back_at,v_live)
      else x.rolled_back_at
    end,
    rollback_error=case
      when p_outcome in ('FAILED','BLOCKED') then coalesce(v_error,r.last_error)
      else null
    end,
    monitor_status=case
      when p_outcome='ROLLED_BACK' then 'STOPPED'
      else x.monitor_status
    end,
    recovery_status=case
      when p_outcome='ROLLED_BACK' and x.recovery_status='NONE' then 'MONITORING'
      else x.recovery_status
    end,
    recovery_lock_until=case
      when p_outcome='ROLLED_BACK' and x.recovery_status='NONE'
        then v_live + make_interval(days=>v_recovery_hard_stop_days)
      else x.recovery_lock_until
    end,
    rollback_review_reason=case
      when p_outcome='ROLLED_BACK' then
        'AUTO ROLLBACK completed after GSC checkpoint '||coalesce(m.checkpoint_days,0)||
        'd REGRESSED. Recovery Measurement 7/14/28d is now monitoring the URL. Revert commit: '||
        coalesce(v_revert_sha,'unknown')
      when p_outcome='BLOCKED' then
        'AUTO ROLLBACK blocked: '||coalesce(v_error,r.last_error,'human review required')
      else x.rollback_review_reason
    end
  where x.id=r.execution_id;

  if p_outcome='ROLLED_BACK' then
    update public.commerce_gsc_action_queue
    set
      owner_note=concat_ws(
        E'\n',
        owner_note,
        'Auto rollback executed after '||coalesce(m.checkpoint_days,0)||
        'd REGRESSED measurement. Recovery Measurement 7/14/28d started. Revert commit '||v_revert_sha
      ),
      updated_at=now()
    where id=r.action_id;
  end if;

  perform private.refresh_gsc_learning_ledger();
  perform private.refresh_gsc_executor_guards();

  return to_jsonb(r);
end;
$$;

revoke all on function public.finish_gsc_rollback_job(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_gsc_rollback_job(uuid,text,jsonb) to service_role;

-- Action measurements continuously feed the Learning Ledger.
create or replace function private.gsc_learning_measurement_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_gsc_learning_ledger();
  return new;
end;
$$;

drop trigger if exists commerce_gsc_action_measurement_learning
  on public.commerce_gsc_action_measurements;
create trigger commerce_gsc_action_measurement_learning
after insert or update on public.commerce_gsc_action_measurements
for each statement
execute function private.gsc_learning_measurement_trigger();

select private.refresh_gsc_learning_ledger();
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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements(); select private.refresh_gsc_rollback_recovery_measurements(); select private.refresh_gsc_learning_ledger(); select private.refresh_gsc_executor_guards();'
);

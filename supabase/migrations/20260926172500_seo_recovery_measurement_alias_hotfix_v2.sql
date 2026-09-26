-- Second hotfix: scope the alias fix only to the hard-stop UPDATE so loop references keep the PL/pgSQL record.
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
  update public.commerce_gsc_action_executions x
  set
    recovery_status='BLOCKED',
    recovery_final_verdict='INSUFFICIENT_DATA',
    recovery_complete_at=now(),
    recovery_lock_until=null,
    rollback_review_reason=concat_ws(
      E'\n',
      x.rollback_review_reason,
      'Recovery Measurement hard-stop reached without a valid 28d checkpoint; released Page Experiment Lock for human review.'
    )
  where x.recovery_status='MONITORING'
    and x.rolled_back_at is not null
    and x.rolled_back_at <= now() - make_interval(
      days => coalesce(
        (select p.recovery_hard_stop_days
         from public.commerce_gsc_executor_policy p
         where p.repository=x.repository),
        35
      )
    )
    and not exists (
      select 1
      from public.commerce_gsc_rollback_recovery_measurements r
      where r.execution_id=x.id
        and r.checkpoint_days=28
        and r.integrity_status='PASS'
    );

  perform private.refresh_gsc_learning_ledger();
  perform private.refresh_gsc_executor_guards();
end;
$$;

revoke all on function private.refresh_gsc_rollback_recovery_measurements() from public,anon,authenticated;
grant execute on function private.refresh_gsc_rollback_recovery_measurements() to service_role;


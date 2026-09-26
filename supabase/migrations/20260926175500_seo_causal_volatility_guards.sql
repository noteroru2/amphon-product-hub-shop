-- Causal Attribution Guard + Sitewide Volatility Guard
-- Prevents a local SEO experiment from being credited/blamed when:
-- 1) unknown production code changed during the measurement window, or
-- 2) the broader site's ranking distribution moved in the same direction.

alter table public.commerce_gsc_executor_policy
  add column if not exists causal_audit_required boolean not null default true,
  add column if not exists volatility_min_peer_rows integer not null default 30
    check (volatility_min_peer_rows between 10 and 500),
  add column if not exists volatility_position_shift numeric not null default 1.0
    check (volatility_position_shift between 0.25 and 5),
  add column if not exists volatility_shift_share numeric not null default 0.40
    check (volatility_shift_share between 0.20 and 0.90),
  add column if not exists volatility_median_position_delta numeric not null default 0.75
    check (volatility_median_position_delta between 0.25 and 5);

update public.commerce_gsc_executor_policy
set
  causal_audit_required=true,
  volatility_min_peer_rows=30,
  volatility_position_shift=1.0,
  volatility_shift_share=0.40,
  volatility_median_position_delta=0.75,
  updated_at=now()
where repository='noteroru2/amphon.co.th';

create table if not exists public.commerce_gsc_site_change_audit (
  id uuid primary key default gen_random_uuid(),
  repository text not null,
  commit_sha text not null,
  parent_sha text,
  committed_at timestamptz not null,
  changed_files text[] not null default '{}'::text[],
  commit_message text,
  event_name text,
  reported_at timestamptz not null default now(),
  unique(repository,commit_sha)
);

create index if not exists commerce_gsc_site_change_audit_time_idx
  on public.commerce_gsc_site_change_audit(repository,committed_at desc);

alter table public.commerce_gsc_site_change_audit enable row level security;
drop policy if exists commerce_gsc_site_change_audit_read_admin
  on public.commerce_gsc_site_change_audit;
create policy commerce_gsc_site_change_audit_read_admin
on public.commerce_gsc_site_change_audit
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_site_change_audit from anon;
revoke insert,update,delete on public.commerce_gsc_site_change_audit from authenticated;
grant select on public.commerce_gsc_site_change_audit to authenticated;
grant select,insert,update,delete on public.commerce_gsc_site_change_audit to service_role;

create table if not exists public.commerce_gsc_sitewide_query_snapshots (
  id uuid primary key default gen_random_uuid(),
  property text not null,
  query text not null,
  page text not null,
  window_days integer not null,
  source_fetched_at timestamptz not null,
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  captured_at timestamptz not null default now(),
  unique(property,query,page,window_days,source_fetched_at)
);

create index if not exists commerce_gsc_sitewide_snapshots_lookup_idx
  on public.commerce_gsc_sitewide_query_snapshots(property,window_days,source_fetched_at desc);

alter table public.commerce_gsc_sitewide_query_snapshots enable row level security;
drop policy if exists commerce_gsc_sitewide_snapshots_read_admin
  on public.commerce_gsc_sitewide_query_snapshots;
create policy commerce_gsc_sitewide_snapshots_read_admin
on public.commerce_gsc_sitewide_query_snapshots
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on public.commerce_gsc_sitewide_query_snapshots from anon;
revoke insert,update,delete on public.commerce_gsc_sitewide_query_snapshots from authenticated;
grant select on public.commerce_gsc_sitewide_query_snapshots to authenticated;
grant select,insert,update,delete on public.commerce_gsc_sitewide_query_snapshots to service_role;

create or replace function public.report_gsc_site_changes(
  p_repository text,
  p_commits jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_count integer := 0;
  v_sha text;
  v_parent text;
  v_files text[];
  v_committed_at timestamptz;
begin
  if p_repository <> 'noteroru2/amphon.co.th' then
    raise exception 'UNSUPPORTED_CHANGE_AUDIT_REPOSITORY';
  end if;
  if jsonb_typeof(p_commits) <> 'array' then
    raise exception 'COMMITS_MUST_BE_ARRAY';
  end if;
  if jsonb_array_length(p_commits) > 100 then
    raise exception 'TOO_MANY_COMMITS';
  end if;

  for c in select value from jsonb_array_elements(p_commits)
  loop
    v_sha := lower(coalesce(c->>'sha',''));
    v_parent := nullif(lower(coalesce(c->>'parentSha','')),'');
    if v_sha !~ '^[0-9a-f]{40}$' then
      raise exception 'INVALID_COMMIT_SHA';
    end if;
    if v_parent is not null and v_parent !~ '^[0-9a-f]{40}$' then
      raise exception 'INVALID_PARENT_SHA';
    end if;

    begin
      v_committed_at := (c->>'committedAt')::timestamptz;
    exception when others then
      raise exception 'INVALID_COMMIT_TIMESTAMP';
    end;

    select coalesce(array_agg(value order by value),'{}'::text[])
    into v_files
    from jsonb_array_elements_text(coalesce(c->'changedFiles','[]'::jsonb));

    insert into public.commerce_gsc_site_change_audit(
      repository,commit_sha,parent_sha,committed_at,changed_files,commit_message,event_name,reported_at
    ) values (
      p_repository,v_sha,v_parent,v_committed_at,v_files,
      nullif(c->>'message',''),nullif(c->>'eventName',''),now()
    )
    on conflict(repository,commit_sha) do update set
      parent_sha=excluded.parent_sha,
      committed_at=excluded.committed_at,
      changed_files=excluded.changed_files,
      commit_message=excluded.commit_message,
      event_name=coalesce(excluded.event_name,public.commerce_gsc_site_change_audit.event_name),
      reported_at=now();

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('reported',v_count);
end;
$$;

revoke all on function public.report_gsc_site_changes(text,jsonb) from public,anon,authenticated;
grant execute on function public.report_gsc_site_changes(text,jsonb) to service_role;

create or replace function private.capture_gsc_sitewide_query_snapshots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.commerce_gsc_sitewide_query_snapshots(
    property,query,page,window_days,source_fetched_at,clicks,impressions,ctr,position,captured_at
  )
  select
    d.property,d.query,d.page,d.window_days,d.fetched_at,
    d.clicks,d.impressions,d.ctr,d.position,now()
  from public.commerce_gsc_query_demand d
  where d.window_days=28
  on conflict(property,query,page,window_days,source_fetched_at) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function private.capture_gsc_sitewide_query_snapshots() from public,anon,authenticated;
grant execute on function private.capture_gsc_sitewide_query_snapshots() to service_role;

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

  select coalesce(max(p.causal_audit_required),true)
  into v_required
  from public.commerce_gsc_executor_policy p
  where p.repository=coalesce(e.repository,'noteroru2/amphon.co.th');

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

create or replace function private.gsc_sitewide_volatility_context(
  p_execution_id uuid,
  p_source_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_min_peers integer := 30;
  v_row_shift numeric := 1.0;
  v_share_threshold numeric := 0.40;
  v_median_threshold numeric := 0.75;
  v_peer_count integer := 0;
  v_median_delta numeric;
  v_worsened_share numeric;
  v_improved_share numeric;
  v_baseline_latest timestamptz;
  v_status text;
  v_reason text;
begin
  select x.*,a.property,a.page
  into e
  from public.commerce_gsc_action_executions x
  join public.commerce_gsc_action_queue a on a.id=x.action_id
  where x.id=p_execution_id;

  if e.id is null or p_source_fetched_at is null then
    return jsonb_build_object(
      'status','UNKNOWN','codes',jsonb_build_array('VOLATILITY_CONTEXT_MISSING'),
      'reason','Sitewide volatility could not resolve the execution or current GSC source timestamp.',
      'peerCount',0
    );
  end if;

  select
    coalesce(max(p.volatility_min_peer_rows),30),
    coalesce(max(p.volatility_position_shift),1.0),
    coalesce(max(p.volatility_shift_share),0.40),
    coalesce(max(p.volatility_median_position_delta),0.75)
  into v_min_peers,v_row_shift,v_share_threshold,v_median_threshold
  from public.commerce_gsc_executor_policy p
  where p.repository=coalesce(e.repository,'noteroru2/amphon.co.th');

  with baseline as (
    select distinct on (s.query,s.page)
      s.query,s.page,s.impressions,s.position,s.source_fetched_at
    from public.commerce_gsc_sitewide_query_snapshots s
    where s.property=e.property
      and s.window_days=28
      and s.page<>e.page
      and s.source_fetched_at <= e.applied_at
    order by s.query,s.page,s.source_fetched_at desc
  ),
  peers as (
    select
      b.query,b.page,b.source_fetched_at,
      d.position-b.position as position_delta
    from baseline b
    join public.commerce_gsc_query_demand d
      on d.property=e.property
     and d.window_days=28
     and d.query=b.query
     and d.page=b.page
    where b.impressions>=10
      and d.impressions>=10
      and d.fetched_at <= p_source_fetched_at + interval '15 minutes'
  )
  select
    count(*)::int,
    percentile_cont(0.5) within group(order by position_delta),
    avg(case when position_delta>=v_row_shift then 1 else 0 end)::numeric,
    avg(case when position_delta<=-v_row_shift then 1 else 0 end)::numeric,
    max(source_fetched_at)
  into
    v_peer_count,v_median_delta,v_worsened_share,v_improved_share,v_baseline_latest
  from peers;

  if v_peer_count < v_min_peers then
    v_status := 'UNKNOWN';
    v_reason := 'Sitewide Volatility Guard has only '||v_peer_count||'/'||v_min_peers||
      ' comparable peer query-page rows from a pre-experiment snapshot.';
  elsif abs(coalesce(v_median_delta,0)) >= v_median_threshold
    and greatest(coalesce(v_worsened_share,0),coalesce(v_improved_share,0)) >= v_share_threshold then
    v_status := 'EXTERNAL_SHIFT';
    v_reason := 'Sitewide Volatility Guard detected a broad ranking shift: median position delta '||
      round(v_median_delta,2)||', worse share '||round(v_worsened_share*100,1)||
      '%, better share '||round(v_improved_share*100,1)||'%.';
  else
    v_status := 'PASS';
    v_reason := 'Sitewide Volatility PASS: '||v_peer_count||
      ' peer query-page rows do not show a broad directional ranking shift.';
  end if;

  return jsonb_build_object(
    'status',v_status,
    'codes',case
      when v_status='EXTERNAL_SHIFT' then jsonb_build_array('SITEWIDE_VOLATILITY')
      when v_status='UNKNOWN' then jsonb_build_array('VOLATILITY_BASELINE_MISSING')
      else '[]'::jsonb
    end,
    'reason',v_reason,
    'peerCount',v_peer_count,
    'medianPositionDelta',v_median_delta,
    'worsenedShare',v_worsened_share,
    'improvedShare',v_improved_share,
    'baselineSourceFetchedAt',v_baseline_latest
  );
end;
$$;

revoke all on function private.gsc_sitewide_volatility_context(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.gsc_sitewide_volatility_context(uuid,timestamptz) to service_role;

alter table public.commerce_gsc_action_measurements
  add column if not exists causal_status text not null default 'UNKNOWN'
    check (causal_status in ('PASS','CONTAMINATED','UNKNOWN')),
  add column if not exists causal_reason text,
  add column if not exists contaminating_commit_count integer not null default 0,
  add column if not exists contaminating_commits jsonb not null default '[]'::jsonb,
  add column if not exists volatility_status text not null default 'UNKNOWN'
    check (volatility_status in ('PASS','EXTERNAL_SHIFT','UNKNOWN')),
  add column if not exists volatility_reason text,
  add column if not exists volatility_peer_count integer not null default 0,
  add column if not exists volatility_median_position_delta numeric,
  add column if not exists volatility_worsened_share numeric,
  add column if not exists volatility_improved_share numeric;

alter table public.commerce_gsc_action_measurements
  drop constraint if exists commerce_gsc_action_measurements_verdict_check;
alter table public.commerce_gsc_action_measurements
  add constraint commerce_gsc_action_measurements_verdict_check
  check (verdict in ('IMPROVED','NEUTRAL','REGRESSED','INSUFFICIENT_DATA','CONTAMINATED','EXTERNAL_SHIFT'));

alter table public.commerce_gsc_rollback_recovery_measurements
  add column if not exists causal_status text not null default 'UNKNOWN'
    check (causal_status in ('PASS','CONTAMINATED','UNKNOWN')),
  add column if not exists causal_reason text,
  add column if not exists contaminating_commit_count integer not null default 0,
  add column if not exists contaminating_commits jsonb not null default '[]'::jsonb,
  add column if not exists volatility_status text not null default 'UNKNOWN'
    check (volatility_status in ('PASS','EXTERNAL_SHIFT','UNKNOWN')),
  add column if not exists volatility_reason text,
  add column if not exists volatility_peer_count integer not null default 0,
  add column if not exists volatility_median_position_delta numeric,
  add column if not exists volatility_worsened_share numeric,
  add column if not exists volatility_improved_share numeric;

create or replace function private.gsc_action_measurement_context_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v jsonb;
  v_base_pass boolean;
  v_extra_codes text[] := '{}'::text[];
begin
  c := private.gsc_causal_attribution_context(new.execution_id,new.source_fetched_at);
  v := private.gsc_sitewide_volatility_context(new.execution_id,new.source_fetched_at);

  new.causal_status := coalesce(c->>'status','UNKNOWN');
  new.causal_reason := c->>'reason';
  new.contaminating_commit_count := coalesce((c->>'contaminatingCommitCount')::integer,0);
  new.contaminating_commits := coalesce(c->'contaminatingCommits','[]'::jsonb);

  new.volatility_status := coalesce(v->>'status','UNKNOWN');
  new.volatility_reason := v->>'reason';
  new.volatility_peer_count := coalesce((v->>'peerCount')::integer,0);
  new.volatility_median_position_delta := nullif(v->>'medianPositionDelta','')::numeric;
  new.volatility_worsened_share := nullif(v->>'worsenedShare','')::numeric;
  new.volatility_improved_share := nullif(v->>'improvedShare','')::numeric;

  v_base_pass := new.integrity_status='PASS';

  if new.causal_status='CONTAMINATED' then
    v_extra_codes := array_append(v_extra_codes,'CAUSAL_CONTAMINATION');
  elsif new.causal_status='UNKNOWN' then
    v_extra_codes := array_append(v_extra_codes,'ATTRIBUTION_AUDIT_GAP');
  end if;

  if new.volatility_status='EXTERNAL_SHIFT' then
    v_extra_codes := array_append(v_extra_codes,'SITEWIDE_VOLATILITY');
  elsif new.volatility_status='UNKNOWN' then
    v_extra_codes := array_append(v_extra_codes,'VOLATILITY_BASELINE_MISSING');
  end if;

  if cardinality(v_extra_codes)>0 then
    new.integrity_codes := array(
      select distinct x
      from unnest(coalesce(new.integrity_codes,'{}'::text[]) || v_extra_codes) x
    );
    new.integrity_reason := concat_ws(
      ' ',
      new.integrity_reason,
      'Causal: '||coalesce(new.causal_reason,'unknown')||
      ' Sitewide: '||coalesce(new.volatility_reason,'unknown')
    );
  end if;

  if v_base_pass then
    if new.causal_status='CONTAMINATED' then
      new.integrity_status := 'BLOCKED';
      new.verdict := 'CONTAMINATED';
      new.rollback_recommended := false;
    elsif new.causal_status='UNKNOWN' then
      new.integrity_status := 'BLOCKED';
      new.verdict := 'INSUFFICIENT_DATA';
      new.rollback_recommended := false;
    elsif new.volatility_status='EXTERNAL_SHIFT' then
      new.integrity_status := 'BLOCKED';
      new.verdict := 'EXTERNAL_SHIFT';
      new.rollback_recommended := false;
    elsif new.volatility_status='UNKNOWN' then
      new.integrity_status := 'BLOCKED';
      new.verdict := 'INSUFFICIENT_DATA';
      new.rollback_recommended := false;
    end if;
  else
    new.rollback_recommended := false;
  end if;

  return new;
end;
$$;

drop trigger if exists commerce_gsc_action_measurement_context_guard
  on public.commerce_gsc_action_measurements;
create trigger commerce_gsc_action_measurement_context_guard
before insert or update
on public.commerce_gsc_action_measurements
for each row
execute function private.gsc_action_measurement_context_guard();

create or replace function private.gsc_recovery_measurement_context_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v jsonb;
  v_extra_codes text[] := '{}'::text[];
begin
  c := private.gsc_causal_attribution_context(new.execution_id,new.source_fetched_at);
  v := private.gsc_sitewide_volatility_context(new.execution_id,new.source_fetched_at);

  new.causal_status := coalesce(c->>'status','UNKNOWN');
  new.causal_reason := c->>'reason';
  new.contaminating_commit_count := coalesce((c->>'contaminatingCommitCount')::integer,0);
  new.contaminating_commits := coalesce(c->'contaminatingCommits','[]'::jsonb);

  new.volatility_status := coalesce(v->>'status','UNKNOWN');
  new.volatility_reason := v->>'reason';
  new.volatility_peer_count := coalesce((v->>'peerCount')::integer,0);
  new.volatility_median_position_delta := nullif(v->>'medianPositionDelta','')::numeric;
  new.volatility_worsened_share := nullif(v->>'worsenedShare','')::numeric;
  new.volatility_improved_share := nullif(v->>'improvedShare','')::numeric;

  if new.causal_status='CONTAMINATED' then
    v_extra_codes := array_append(v_extra_codes,'CAUSAL_CONTAMINATION');
  elsif new.causal_status='UNKNOWN' then
    v_extra_codes := array_append(v_extra_codes,'ATTRIBUTION_AUDIT_GAP');
  end if;

  if new.volatility_status='EXTERNAL_SHIFT' then
    v_extra_codes := array_append(v_extra_codes,'SITEWIDE_VOLATILITY');
  elsif new.volatility_status='UNKNOWN' then
    v_extra_codes := array_append(v_extra_codes,'VOLATILITY_BASELINE_MISSING');
  end if;

  if cardinality(v_extra_codes)>0 then
    new.integrity_codes := array(
      select distinct x
      from unnest(coalesce(new.integrity_codes,'{}'::text[]) || v_extra_codes) x
    );
    new.integrity_reason := concat_ws(
      ' ',
      new.integrity_reason,
      'Causal: '||coalesce(new.causal_reason,'unknown')||
      ' Sitewide: '||coalesce(new.volatility_reason,'unknown')
    );

    if new.integrity_status='PASS' then
      new.integrity_status := 'BLOCKED';
      new.verdict := 'INSUFFICIENT_DATA';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists commerce_gsc_recovery_measurement_context_guard
  on public.commerce_gsc_rollback_recovery_measurements;
create trigger commerce_gsc_recovery_measurement_context_guard
before insert or update
on public.commerce_gsc_rollback_recovery_measurements
for each row
execute function private.gsc_recovery_measurement_context_guard();

create or replace function private.gsc_execution_context_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.commerce_gsc_action_measurements;
  r public.commerce_gsc_rollback_recovery_measurements;
begin
  if new.monitor_status='ROLLBACK_REVIEW'
     and (
       old.monitor_status is distinct from new.monitor_status
       or old.last_measured_at is distinct from new.last_measured_at
     ) then
    select * into m
    from public.commerce_gsc_action_measurements
    where execution_id=new.id
    order by measured_at desc,checkpoint_days desc
    limit 1;

    if m.id is not null
       and (m.verdict<>'REGRESSED' or not m.rollback_recommended or m.integrity_status<>'PASS') then
      new.monitor_status := case
        when m.checkpoint_days=28 and m.verdict in ('CONTAMINATED','EXTERNAL_SHIFT') then 'COMPLETE'
        else 'MONITORING'
      end;
      new.rollback_review_reason := 'Rollback blocked by measurement context guard: '||
        m.verdict||'. '||coalesce(m.causal_reason,'')||' '||coalesce(m.volatility_reason,'');
    end if;
  end if;

  if new.recovery_status='COMPLETE'
     and old.recovery_status is distinct from new.recovery_status then
    select * into r
    from public.commerce_gsc_rollback_recovery_measurements
    where execution_id=new.id and checkpoint_days=28
    order by measured_at desc
    limit 1;

    if r.id is null or r.integrity_status<>'PASS' or r.verdict='INSUFFICIENT_DATA' then
      new.recovery_status := 'MONITORING';
      new.recovery_final_verdict := null;
      new.recovery_complete_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists commerce_gsc_execution_context_gate
  on public.commerce_gsc_action_executions;
create trigger commerce_gsc_execution_context_gate
before update of monitor_status,last_measured_at,recovery_status,recovery_final_verdict
on public.commerce_gsc_action_executions
for each row
execute function private.gsc_execution_context_gate();

select private.capture_gsc_sitewide_query_snapshots();

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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue(); select private.refresh_gsc_recovery_diagnostics(); select private.refresh_gsc_executor_jobs(); select private.refresh_gsc_prior_selector(); select private.capture_gsc_sitewide_query_snapshots(); select private.refresh_merchant_feed_diagnostics(); select private.ensure_commerce_review_invites(); select private.refresh_gsc_action_measurements(); select private.refresh_gsc_rollback_recovery_measurements(); select private.refresh_gsc_learning_ledger(); select private.refresh_gsc_learning_prior_snapshots(); select private.refresh_gsc_prior_selector(); select private.refresh_gsc_executor_guards();'
);

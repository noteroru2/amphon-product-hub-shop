create table if not exists public.commerce_gsc_action_queue (
  id uuid primary key default gen_random_uuid(),
  property text not null,
  page text not null,
  action_type text not null check (action_type in (
    'META_REVIEW','INTERNAL_LINK_BOOST','RECOVERY_PLAN','PROTECT_PAGE','BRAND_WATCH','WATCH'
  )),
  execution_mode text not null default 'REVIEW' check (execution_mode in ('REVIEW','AUTO_GUARD')),
  status text not null default 'OPEN' check (status in ('OPEN','APPROVED','APPLIED','DISMISSED','PROTECTED','STALE')),
  primary_query text not null,
  query_count integer not null default 1,
  clicks numeric not null default 0,
  impressions numeric not null default 0,
  ctr numeric not null default 0,
  position numeric not null default 0,
  priority_score numeric not null default 0,
  opportunity_type text not null,
  recommended_action text not null,
  candidate_focus_query text,
  candidate_title text,
  candidate_description text,
  candidate_notes text,
  candidate_generated_at timestamptz,
  owner_note text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (property, page)
);

create index if not exists commerce_gsc_action_queue_priority_idx
  on public.commerce_gsc_action_queue (status, priority_score desc, updated_at desc);
create index if not exists commerce_gsc_action_queue_action_idx
  on public.commerce_gsc_action_queue (action_type, status, priority_score desc);

alter table public.commerce_gsc_action_queue enable row level security;

drop policy if exists commerce_gsc_action_queue_read_admin on public.commerce_gsc_action_queue;
create policy commerce_gsc_action_queue_read_admin
on public.commerce_gsc_action_queue
for select to authenticated
using (public.current_user_role() in ('owner','admin'));

revoke all on table public.commerce_gsc_action_queue from anon;
revoke all on table public.commerce_gsc_action_queue from authenticated;
grant select on table public.commerce_gsc_action_queue to authenticated;
grant select, insert, update, delete on table public.commerce_gsc_action_queue to service_role;

create or replace function private.refresh_commerce_gsc_action_queue()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  with fresh as (
    select *
    from public.commerce_gsc_opportunity_v
    where fetched_at >= now() - interval '3 days'
      and opportunity_type in ('CTR_OPPORTUNITY','TOP10_PUSH','PAGE1_RECOVERY','PROTECT')
      and impressions >= 10
      and (
        page like 'https://amphon.co.th/%'
        or page like 'https://shop.amphon.co.th/%'
      )
  ),
  grouped as (
    select
      property,
      page,
      opportunity_type,
      sum(clicks)::numeric as clicks,
      sum(impressions)::numeric as impressions,
      case when sum(impressions) > 0 then sum(clicks) / sum(impressions) else 0 end::numeric as ctr,
      case when sum(impressions) > 0
        then sum(position * impressions) / sum(impressions)
        else avg(position)
      end::numeric as position,
      count(*)::int as query_count,
      sum(opportunity_score)::numeric as priority_score
    from fresh
    group by property,page,opportunity_type
  ),
  ranked_groups as (
    select
      g.*,
      row_number() over (
        partition by property,page
        order by priority_score desc,
          case opportunity_type
            when 'PAGE1_RECOVERY' then 4
            when 'TOP10_PUSH' then 3
            when 'CTR_OPPORTUNITY' then 2
            when 'PROTECT' then 1
            else 0
          end desc
      ) as rn
    from grouped g
  ),
  primary_queries as (
    select distinct on (f.property,f.page,f.opportunity_type)
      f.property,f.page,f.opportunity_type,f.query as primary_query
    from fresh f
    order by f.property,f.page,f.opportunity_type,f.opportunity_score desc,f.impressions desc,f.query
  ),
  chosen as (
    select
      g.property,g.page,g.opportunity_type,g.clicks,g.impressions,g.ctr,g.position,
      g.query_count,g.priority_score,p.primary_query,
      case
        when lower(p.primary_query) ~ '(amphon|amphontd|อำพล|อําพล)' then 'BRAND_WATCH'
        when g.opportunity_type='CTR_OPPORTUNITY' then 'META_REVIEW'
        when g.opportunity_type='TOP10_PUSH' then 'INTERNAL_LINK_BOOST'
        when g.opportunity_type='PAGE1_RECOVERY' then 'RECOVERY_PLAN'
        when g.opportunity_type='PROTECT' then 'PROTECT_PAGE'
        else 'WATCH'
      end as action_type
    from ranked_groups g
    join primary_queries p
      using(property,page,opportunity_type)
    where g.rn=1
  )
  insert into public.commerce_gsc_action_queue(
    property,page,action_type,execution_mode,status,primary_query,query_count,
    clicks,impressions,ctr,position,priority_score,opportunity_type,
    recommended_action,candidate_focus_query,first_seen_at,last_seen_at,updated_at
  )
  select
    c.property,
    c.page,
    c.action_type,
    case when c.action_type in ('PROTECT_PAGE','BRAND_WATCH') then 'AUTO_GUARD' else 'REVIEW' end,
    case when c.action_type='PROTECT_PAGE' then 'PROTECTED' else 'OPEN' end,
    c.primary_query,
    c.query_count,
    c.clicks,
    c.impressions,
    c.ctr,
    c.position,
    c.priority_score,
    c.opportunity_type,
    case c.action_type
      when 'META_REVIEW' then
        'สร้าง Title/Description candidate จาก query จริงเพื่อให้เจ้าของตรวจ ก่อนแก้หน้า ห้าม auto-rewrite'
      when 'INTERNAL_LINK_BOOST' then
        'เพิ่ม contextual internal links จากหน้าที่เกี่ยวข้องไปยัง URL owner นี้ โดยไม่เปลี่ยน H1/URL/canonical'
      when 'RECOVERY_PLAN' then
        'ตรวจ cannibalization, query coverage, internal authority และ freshness ก่อนเสนอ recovery patch'
      when 'PROTECT_PAGE' then
        'PROTECT: ห้าม rewrite Title/H1/URL/canonical อัตโนมัติ เฝ้าดูอันดับและ CTR'
      when 'BRAND_WATCH' then
        'Brand/navigation query: เฝ้าดูเท่านั้น ไม่ใช้เป็นเหตุผลแก้ Title หรือสร้างหน้าใหม่'
      else
        'เฝ้าดูข้อมูลเพิ่มก่อนเปลี่ยนหน้า'
    end,
    c.primary_query,
    now(),
    now(),
    now()
  from chosen c
  on conflict (property,page) do update set
    action_type=excluded.action_type,
    execution_mode=excluded.execution_mode,
    primary_query=excluded.primary_query,
    query_count=excluded.query_count,
    clicks=excluded.clicks,
    impressions=excluded.impressions,
    ctr=excluded.ctr,
    position=excluded.position,
    priority_score=excluded.priority_score,
    opportunity_type=excluded.opportunity_type,
    recommended_action=excluded.recommended_action,
    candidate_focus_query=excluded.candidate_focus_query,
    last_seen_at=now(),
    updated_at=now(),
    status=case
      when public.commerce_gsc_action_queue.status in ('APPLIED','DISMISSED') then public.commerce_gsc_action_queue.status
      when excluded.action_type='PROTECT_PAGE' then 'PROTECTED'
      when public.commerce_gsc_action_queue.status='PROTECTED' and excluded.action_type <> 'PROTECT_PAGE' then 'OPEN'
      when public.commerce_gsc_action_queue.status='STALE' then 'OPEN'
      else public.commerce_gsc_action_queue.status
    end;

  update public.commerce_gsc_action_queue
  set status='STALE', updated_at=now()
  where status in ('OPEN','PROTECTED')
    and (
      last_seen_at < now() - interval '3 days'
      or not (page like 'https://amphon.co.th/%' or page like 'https://shop.amphon.co.th/%')
    );
end;
$$;

revoke all on function private.refresh_commerce_gsc_action_queue() from public;
revoke all on function private.refresh_commerce_gsc_action_queue() from anon;
revoke all on function private.refresh_commerce_gsc_action_queue() from authenticated;
grant execute on function private.refresh_commerce_gsc_action_queue() to service_role;

create or replace function public.set_gsc_action_status(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns public.commerce_gsc_action_queue
language plpgsql
security definer
set search_path = public, pg_temp
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
  return result_row;
end;
$$;

revoke all on function public.set_gsc_action_status(uuid,text,text) from public;
revoke all on function public.set_gsc_action_status(uuid,text,text) from anon;
grant execute on function public.set_gsc_action_status(uuid,text,text) to authenticated;
grant execute on function public.set_gsc_action_status(uuid,text,text) to service_role;

select private.refresh_commerce_gsc_action_queue();

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
  'select private.sync_commerce_model_longtails(); select private.apply_commerce_seo_governance(); select private.refresh_commerce_spec_pages(); select private.refresh_commerce_gsc_action_queue();'
);

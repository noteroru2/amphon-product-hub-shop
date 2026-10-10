-- Restricted bridge for the authenticated Edge Function only. Vault requires definer privileges.
create function public.commerce_gsc_internal(p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  sid uuid; cid uuid; actor_id uuid; item jsonb; cfg jsonb; result jsonb;
  job record; chosen text; count_sites integer:=0;
begin
  if p_action='scheduler_key' then
    select decrypted_secret into chosen from vault.decrypted_secrets where name='seo_gsc_scheduler_key';
    return to_jsonb(chosen);
  elsif p_action='config' then
    select decrypted_secret::jsonb into cfg from vault.decrypted_secrets where name='seo_gsc_oauth_config';
    return coalesce(cfg,'{}'::jsonb);
  elsif p_action='configure' then
    select id into sid from vault.secrets where name='seo_gsc_oauth_config';
    if sid is null then perform vault.create_secret(p_data::text,'seo_gsc_oauth_config');
    else perform vault.update_secret(sid,p_data::text); end if;
    -- Old pending authorizations cannot complete with different client credentials.
    update public.commerce_gsc_oauth_states set expires_at=now();
    return '{"saved":true}'::jsonb;
  elsif p_action='status' then
    return jsonb_build_object('configured',exists(select 1 from vault.secrets where name='seo_gsc_oauth_config'),
      'connections',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'state',c.state,'created_at',c.created_at,
        'property_count',jsonb_array_length(c.properties))) from public.commerce_gsc_connections c where c.state<>'DISCONNECTED'),'[]'::jsonb),
      'jobs',coalesce((select jsonb_agg(jsonb_build_object('site_id',j.site_id,'next_at',j.next_at,
        'last_success_at',j.last_success_at,'last_error',j.last_error,'running',j.lease_until>now()))
        from public.commerce_gsc_sync_jobs j),'[]'::jsonb));
  elsif p_action='state_create' then
    -- Expired states cannot be consumed; retain metadata for debugging.
    insert into public.commerce_gsc_oauth_states(state_hash,actor,verifier)
      values(p_data->>'hash',(p_data->>'actor')::uuid,p_data->>'verifier');
    return '{}'::jsonb;
  elsif p_action='state_consume' then
    update public.commerce_gsc_oauth_states set expires_at=now() where state_hash=p_data->>'hash' and expires_at>now()
      returning actor,verifier into actor_id,chosen;
    if actor_id is null or not exists(select 1 from public.profiles where id=actor_id and active and role in ('owner','admin')) then
      raise exception 'Authorization expired or invalid';
    end if;
    return jsonb_build_object('actor',actor_id,'verifier',chosen);
  elsif p_action='connect' then
    cid:=gen_random_uuid();
    sid:=vault.create_secret(p_data->>'refresh_token','seo_gsc_refresh_'||cid::text);
    insert into public.commerce_gsc_connections(id,connected_by,token_secret_id,properties)
      values(cid,(p_data->>'actor')::uuid,sid,p_data->'properties');
    for job in select * from public.commerce_seo_sites where enabled loop
      -- The Edge Function maps only exact registered properties / host prefixes.
      chosen:=p_data->'mapping'->>job.id;
      if chosen is not null then
        insert into public.commerce_gsc_sync_jobs(site_id,connection_id,property) values(job.id,cid,chosen)
          on conflict(site_id) do update set connection_id=excluded.connection_id,property=excluded.property,
            next_at=now(),lease_id=null,lease_until=null,attempts=0,last_error=null;
        update public.commerce_seo_sites set gsc_state='UNCONNECTED',gsc_note='เชื่อม Google แล้ว รอนำเข้าข้อมูลครั้งแรก' where id=job.id;
        count_sites:=count_sites+1;
      end if;
    end loop;
    return jsonb_build_object('connected',count_sites);
  elsif p_action='claim' then
    with due as (
      select j.site_id from public.commerce_gsc_sync_jobs j
      join public.commerce_gsc_connections c on c.id=j.connection_id and c.state='READY'
      join public.commerce_seo_sites s on s.id=j.site_id and s.enabled
      where j.next_at<=now() and (j.lease_until is null or j.lease_until<now())
      order by j.next_at limit 2 for update of j skip locked
    ), claimed as (
      update public.commerce_gsc_sync_jobs j set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes'
      from due where due.site_id=j.site_id returning j.*
    )
    select coalesce(jsonb_agg(jsonb_build_object('site_id',j.site_id,'connection_id',j.connection_id,
      'lease_id',j.lease_id,'property',j.property,'origin',s.origin,'label',s.label,
      'refresh_token',v.decrypted_secret)),'[]'::jsonb) into result
      from claimed j join public.commerce_seo_sites s on s.id=j.site_id
      join public.commerce_gsc_connections c on c.id=j.connection_id
      join vault.decrypted_secrets v on v.id=c.token_secret_id;
    return result;
  elsif p_action='finish' then
    select * into job from public.commerce_gsc_sync_jobs where site_id=p_data->>'site_id'
      and lease_id=(p_data->>'lease_id')::uuid for update;
    if not found then return '{"ignored":true}'::jsonb; end if;
    item:=p_data->'snapshot';
    insert into public.commerce_seo_network_snapshots(site_id,source_at,window_days,clicks,impressions,ctr,position,
      query_rows,queries,coverage,data_start_date,data_end_date,last_data_date,daily,query_truncated)
    values(job.site_id,now(),28,(item->>'clicks')::numeric,(item->>'impressions')::numeric,
      (item->>'ctr')::numeric,(item->>'position')::numeric,jsonb_array_length(item->'queries'),item->'queries','SITE_TOTAL',
      (item->>'start_date')::date,(item->>'end_date')::date,(item->>'last_data_date')::date,item->'daily',(item->>'query_truncated')::boolean);
    update public.commerce_gsc_sync_jobs set next_at=now()+interval '72 hours',last_success_at=now(),
      last_error=null,attempts=0,lease_id=null,lease_until=null where site_id=job.site_id;
    update public.commerce_seo_sites set gsc_state='READY',gsc_note='ข้อมูลตรงจาก Google Search Console API • ช่วง 28 วัน • คำค้นอาจไม่ครบทั้งหมด' where id=job.site_id;
    return '{"saved":true}'::jsonb;
  elsif p_action='fail' then
    select * into job from public.commerce_gsc_sync_jobs where site_id=p_data->>'site_id'
      and lease_id=(p_data->>'lease_id')::uuid for update;
    if not found then return '{"ignored":true}'::jsonb; end if;
    update public.commerce_gsc_sync_jobs set next_at=now()+make_interval(mins=>least(360,15*(2^least(attempts,4))::integer)),
      attempts=attempts+1,last_error=left(p_data->>'error',300),lease_id=null,lease_until=null where site_id=job.site_id;
    if coalesce((p_data->>'reauth')::boolean,false) then
      update public.commerce_gsc_connections set state='REAUTH' where id=job.connection_id;
      update public.commerce_seo_sites set gsc_state='BLOCKED',gsc_note='สิทธิ์ Google หมดอายุหรือถูกถอน กรุณาเชื่อมใหม่'
        where id in(select site_id from public.commerce_gsc_sync_jobs where connection_id=job.connection_id);
    else
      update public.commerce_seo_sites set gsc_state='BLOCKED',gsc_note=left(p_data->>'error',300) where id=job.site_id;
    end if;
    return '{"retry":true}'::jsonb;
  elsif p_action='sync' then
    update public.commerce_gsc_sync_jobs set next_at=now() where lease_until is null or lease_until<now();
    return '{"queued":true}'::jsonb;
  elsif p_action='disconnect' then
    cid:=(p_data->>'id')::uuid;
    select token_secret_id into sid from public.commerce_gsc_connections where id=cid for update;
    update public.commerce_seo_sites set gsc_state='UNCONNECTED',gsc_note='ยกเลิกการเชื่อมต่อ Google แล้ว ผลเก่ายังเก็บไว้'
      where id in(select site_id from public.commerce_gsc_sync_jobs where connection_id=cid);
    update public.commerce_gsc_sync_jobs set next_at='infinity',lease_id=null,lease_until=null where connection_id=cid;
    update public.commerce_gsc_connections set state='DISCONNECTED' where id=cid;
    if sid is not null then perform vault.update_secret(sid,'REVOKED'); end if;
    return '{"disconnected":true}'::jsonb;
  end if;
  raise exception 'Unknown internal operation';
end $$;
revoke all on function public.commerce_gsc_internal(text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_gsc_internal(text,jsonb) to service_role;

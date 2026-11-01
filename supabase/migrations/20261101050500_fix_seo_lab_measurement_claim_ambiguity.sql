-- Restore post-publication SEO experiment measurement worker.
-- Previous claim action failed with SQLSTATE 42702: j.id ambiguous between PL/pgSQL record variable and table alias.
-- Applied to live database 2026-11-01; this migration records the verified function definition.
CREATE OR REPLACE FUNCTION public.seo_lab_internal(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare j public.commerce_seo_content_jobs; n bigint; m public.commerce_seo_content_measurements; claim record; result jsonb:='[]'; before_impressions numeric; after_impressions numeric; change numeric; confounded boolean; event public.commerce_seo_contact_events; page_url text;
begin
 
 if p_action='render_claim' then
 for claim in select id from public.commerce_seo_content_jobs where render_requested_at<=now() and (render_lease_until is null or render_lease_until<now())
 and ((render_action='CAPTURE' and status in ('DRAFT','EVIDENCE_READY')) or (render_action='PUBLISH' and status='APPROVED')) order by render_requested_at limit 2 for update skip locked loop
 update public.commerce_seo_content_jobs set render_lease_id=gen_random_uuid(),render_lease_until=now()+interval '5 minutes' where id=claim.id returning * into j;
 result:=result||jsonb_build_array((select jsonb_build_object('job_id',j.id,'lease_id',j.render_lease_id,'stage',j.render_action,'page',j.page,'origin',s.origin,'approved_body',case when j.render_action='PUBLISH' then j.approved_body end,'proof_excerpt',j.proof_excerpt,'publication_url',j.requested_commit_url,'previous_excerpt',e.excerpt,'previous_hash',e.source_hash)
 from public.commerce_seo_sites s left join public.commerce_seo_content_evidence e on e.id=j.evidence_id where s.id=j.site_id and s.enabled));
 end loop; return result;
 elsif p_action in ('render_finish','render_fail') then
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'job_id')::bigint and render_lease_id=(p_data->>'lease_id')::uuid and render_lease_until>now() for update;
 if j.id is null then raise exception 'Render lease expired'; end if;
 if p_action='render_fail' then
 update public.commerce_seo_content_jobs set render_error=left(p_data->>'error',300),render_requested_at=now()+interval '1 hour',render_lease_id=null,render_lease_until=null where id=j.id;
 elsif j.render_action='CAPTURE' then
 perform public.seo_lab_internal('evidence',p_data);
 update public.commerce_seo_content_evidence set source_kind='RENDERED_PUBLIC_PAGE' where id=(select evidence_id from public.commerce_seo_content_jobs where id=j.id);
 update public.commerce_seo_content_jobs set render_requested_at=null,render_lease_id=null,render_lease_until=null,render_error=null where id=j.id;
 else
 if j.status<>'APPROVED' or j.proof_excerpt is null or private.seo_page(j.site_id,p_data->>'source_url') is null or
 position(j.proof_excerpt in coalesce(p_data->>'excerpt',''))=0 or position(j.proof_excerpt in coalesce((select regexp_replace(excerpt,'\s+',' ','g') from public.commerce_seo_content_evidence where id=j.evidence_id),''))>0 then raise exception 'New approved text not verified'; end if;
 perform public.seo_lab_internal('published',jsonb_build_object('job_id',j.id,'publication_url',j.requested_commit_url,'source_hash',p_data->>'source_hash'));
 update public.commerce_seo_content_jobs set render_requested_at=null,render_lease_id=null,render_lease_until=null,render_error=null where id=j.id;
 end if; return '{"saved":true}';
 elsif p_action='evidence' then
 if length(coalesce(p_data->>'excerpt',''))<100 then raise exception 'Readable public evidence required'; end if;
 
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'job_id')::bigint for update;
 if j.id is null or j.status in ('PUBLISHED','DISMISSED','APPROVED') or private.seo_page(j.site_id,p_data->>'source_url') is null then raise exception 'Editable job and allowlisted evidence required'; end if;
 insert into public.commerce_seo_content_evidence(job_id,source_url,source_hash,page_title,excerpt) values(j.id,p_data->>'source_url',p_data->>'source_hash',p_data->>'page_title',p_data->>'excerpt') returning id into n;
 update public.commerce_seo_content_jobs set evidence_id=n,status='EVIDENCE_READY',updated_at=now() where id=j.id;
 return jsonb_build_object('id',n);
 elsif p_action='published' then
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'job_id')::bigint for update;
 if j.status<>'APPROVED' or j.id is null then raise exception 'Approved job required'; end if;
 update public.commerce_seo_content_jobs set status='PUBLISHED',published_at=now(),publication_url=p_data->>'publication_url',publication_hash=p_data->>'source_hash',updated_at=now() where id=j.id;
 insert into public.commerce_seo_content_measurements(job_id,checkpoint_days,next_at) select j.id,d,now()+make_interval(days=>d+4) from unnest(array[7,14,28]) d;
 return '{"published":true}';
 elsif p_action='claim' then
 for claim in select m.job_id,m.checkpoint_days from public.commerce_seo_content_measurements m join public.commerce_seo_content_jobs j on j.id=m.job_id
 join public.commerce_gsc_sync_jobs g on g.site_id=j.site_id join public.commerce_gsc_connections c on c.id=g.connection_id and c.state='READY'
 where m.measured_at is null and m.next_at<=now() and (m.lease_until is null or m.lease_until<now()) and j.status='PUBLISHED'
 order by m.next_at limit 1 for update of m skip locked loop
 update public.commerce_seo_content_measurements set lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 where job_id=claim.job_id and checkpoint_days=claim.checkpoint_days returning * into m;
 result:=result||jsonb_build_array((select jsonb_build_object('job_id',j.id,'checkpoint_days',m.checkpoint_days,'lease_id',m.lease_id,'published_at',j.published_at,'page',j.page,'query',j.focus_query,
 'property',g.property,'origin',s.origin,'label',s.label,'refresh_token',v.decrypted_secret)
 from public.commerce_seo_content_jobs j join public.commerce_seo_sites s on s.id=j.site_id join public.commerce_gsc_sync_jobs g on g.site_id=s.id
 join public.commerce_gsc_connections c on c.id=g.connection_id join vault.decrypted_secrets v on v.id=c.token_secret_id where j.id=m.job_id));
 end loop; return result;
 elsif p_action in ('finish','fail') then
 select * into m from public.commerce_seo_content_measurements where job_id=(p_data->>'job_id')::bigint and checkpoint_days=(p_data->>'checkpoint_days')::integer and lease_id=(p_data->>'lease_id')::uuid and lease_until>now() for update;
 if m.job_id is null then raise exception 'Measurement lease expired'; end if;
 if p_action='fail' then update public.commerce_seo_content_measurements set last_error=left(p_data->>'error',300),next_at=now()+interval '1 hour',lease_id=null,lease_until=null where job_id=m.job_id and checkpoint_days=m.checkpoint_days;
 else
 select * into j from public.commerce_seo_content_jobs where id=m.job_id;
 before_impressions:=(p_data->'before_data'->>'impressions')::numeric; after_impressions:=(p_data->'after_data'->>'impressions')::numeric;
 change:=(p_data->'after_data'->>'position')::numeric-(p_data->'before_data'->>'position')::numeric;
 confounded:=exists(select 1 from public.commerce_seo_content_jobs other where other.id<>j.id and other.page=j.page and other.status='PUBLISHED' and other.published_at between j.published_at-make_interval(days=>m.checkpoint_days) and j.published_at+make_interval(days=>m.checkpoint_days))
 or exists(select 1 from public.commerce_gsc_action_executions e where e.live_url=j.page and e.applied_at between j.published_at-make_interval(days=>m.checkpoint_days) and j.published_at+make_interval(days=>m.checkpoint_days));
 update public.commerce_seo_content_measurements set measured_at=now(),before_data=p_data->'before_data',after_data=p_data->'after_data',windows=p_data->'windows',last_error=null,lease_id=null,lease_until=null,
 verdict=case when coalesce(before_impressions,0)<50 or coalesce(after_impressions,0)<50 or change is null then 'INSUFFICIENT_DATA' when confounded then 'CONFOUNDED' when change<=-0.5 then 'OBSERVED_UP' when change>=0.5 then 'OBSERVED_DOWN' else 'NO_CLEAR_CHANGE' end
 where job_id=m.job_id and checkpoint_days=m.checkpoint_days;
 end if; return '{"saved":true}';
 elsif p_action='contact' then
 page_url:=private.seo_page(p_data->>'site_id',p_data->>'page');
 if page_url is null or coalesce(p_data->>'session','') !~ '^[a-f0-9]{24,64}$' then raise exception 'Invalid contact source'; end if;
 if (select count(*) from public.commerce_seo_contact_events where session_key=p_data->>'session' and event_day=current_date)>=20
 or (select count(*) from public.commerce_seo_contact_events where created_at>=now()-interval '1 day')>=2000 then return '{}'; end if;
 insert into public.commerce_seo_contact_events(token,site_id,page,session_key,source_channel,referrer_host,sku_hint)
 values(encode(extensions.gen_random_bytes(8),'hex'),p_data->>'site_id',page_url,p_data->>'session',p_data->>'channel',left(p_data->>'referrer_host',200),left(p_data->>'sku',80))
 on conflict(site_id,page,session_key,event_day) do nothing returning * into event;
 if event.id is null then select * into event from public.commerce_seo_contact_events where site_id=p_data->>'site_id' and page=page_url and session_key=p_data->>'session' and event_day=current_date; end if;
 return jsonb_build_object('token',event.token);
 else raise exception 'Unknown internal action'; end if;
end $function$
;

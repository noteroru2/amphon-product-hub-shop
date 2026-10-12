alter table public.commerce_seo_content_jobs
 add column render_action text default 'CAPTURE' check(render_action in ('CAPTURE','PUBLISH')),
 add column render_requested_at timestamptz default now(),
 add column render_lease_id uuid, add column render_lease_until timestamptz,
 add column render_error text, add column proof_excerpt text, add column requested_commit_url text;
create index seo_content_render_due_idx on public.commerce_seo_content_jobs(render_requested_at) where render_requested_at is not null;
update public.commerce_seo_content_jobs j set evidence_id=null,status='DRAFT' where status='EVIDENCE_READY' and exists(select 1 from public.commerce_seo_content_evidence e where e.id=j.evidence_id and length(e.excerpt)<100);

do $$ declare definition text; begin
 select pg_get_functiondef('public.seo_lab_manage(text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if p_action=''create'' then',$branch$
 if p_action in ('render_capture','render_publish') then
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'id')::bigint for update;
 if j.id is null then raise exception 'Job missing'; end if;
 if p_action='render_capture' then
 if j.status not in ('DRAFT','EVIDENCE_READY') then raise exception 'Editable job required'; end if;
 update public.commerce_seo_content_jobs set render_action='CAPTURE',render_requested_at=now(),render_error=null where id=j.id;
 else
 if role_name<>'owner' or j.status<>'APPROVED' then raise exception 'Owner and approved job required' using errcode='42501'; end if;
 if length(coalesce(p_data->>'proof_excerpt',''))<80 or position(regexp_replace(trim(p_data->>'proof_excerpt'),'\s+',' ','g') in regexp_replace(j.approved_body,'\s+',' ','g'))=0 then raise exception 'Approved excerpt required'; end if;
 if coalesce(p_data->>'publication_url','') !~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/commit/[a-f0-9]{40}$' then raise exception 'Full GitHub commit reference required'; end if;
 update public.commerce_seo_content_jobs set render_action='PUBLISH',render_requested_at=now(),render_error=null,proof_excerpt=regexp_replace(trim(p_data->>'proof_excerpt'),'\s+',' ','g'),requested_commit_url=p_data->>'publication_url' where id=j.id;
 end if;
 elsif p_action='create' then
 $branch$);
 definition:=replace(definition,'if j.status<>''EVIDENCE_READY'' or length(j.draft_body)<100','if j.draft_body like ''%[เรียบเรียงคำตอบ%'' then raise exception ''Remove draft placeholders before approval''; end if; if j.status<>''EVIDENCE_READY'' or length(j.draft_body)<100');
 execute definition;
 select pg_get_functiondef('public.seo_lab_internal(text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if p_action=''evidence'' then',$branch$
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
 $branch$);
 execute definition;
end $$;

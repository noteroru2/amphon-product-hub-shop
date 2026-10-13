begin;
do $$
declare a uuid; c uuid; request uuid; receipt uuid; job bigint; opportunity bigint; evidence bigint; snapshot bigint; result jsonb; args jsonb; before_body text; rejected boolean;
begin
 select id into a from public.profiles where active and role='owner' limit 1;
 if a is null then raise exception 'Owner fixture required'; end if;
 result:=public.seo_connector_internal('register','{"name":"rollback-test","redirects":["https://chatgpt.com/callback"]}');c:=(result->>'client_id')::uuid;
 result:=public.seo_connector_internal('start',jsonb_build_object('client_id',c,'redirect_uri','https://chatgpt.com/callback','state','state','challenge','correct','scopes','seo:read seo:draft'));request:=(result->>'id')::uuid;
 perform public.seo_connector_internal('consent',jsonb_build_object('id',request,'actor',a,'code_hash','code-test'));
 args:=jsonb_build_object('client_id',c,'redirect_uri','https://chatgpt.com/callback','grant_type','authorization_code','code_hash','code-test','challenge','wrong','access_hash','access-test','new_refresh_hash','refresh-test');
 if public.seo_connector_internal('exchange',args) is not null then raise exception 'Wrong PKCE accepted'; end if;
 result:=public.seo_connector_internal('exchange',args||'{"challenge":"correct"}');
 if result->>'actor'<>a::text then raise exception 'Correct exchange failed'; end if;
 if public.seo_connector_internal('exchange',args||'{"challenge":"correct"}') is not null then raise exception 'Code replay accepted'; end if;
 if public.seo_connector_internal('auth','{"hash":"access-test"}') is null then raise exception 'Access rejected'; end if;
 result:=public.seo_connector_internal('exchange',jsonb_build_object('client_id',c,'grant_type','refresh_token','refresh_hash','refresh-test','access_hash','access-test-2','new_refresh_hash','refresh-test-2'));
 if result is null or public.seo_connector_internal('auth','{"hash":"access-test"}') is not null then raise exception 'Refresh rotation failed'; end if;
 if public.seo_connector_internal('exchange',jsonb_build_object('client_id',c,'grant_type','refresh_token','refresh_hash','refresh-test','access_hash','access-test-3','new_refresh_hash','refresh-test-3')) is not null then raise exception 'Refresh replay accepted'; end if;
 update public.profiles set active=false where id=a;
 if public.seo_connector_internal('auth','{"hash":"access-test-2"}') is not null then raise exception 'Disabled owner retained access'; end if;
 update public.profiles set active=true where id=a;
 perform public.seo_connector_internal('revoke_all',jsonb_build_object('actor',a));
 if public.seo_connector_internal('auth','{"hash":"access-test-2"}') is not null then raise exception 'Revoked access accepted'; end if;

 select id into snapshot from public.commerce_seo_network_snapshots where site_id='amphon' order by id desc limit 1;
 insert into public.commerce_seo_growth_opportunities(site_id,snapshot_id,query,page,kind,impressions,clicks,priority,recommendation,source_at)
 values('amphon',snapshot,'connector rollback query','https://amphon.co.th/connector-rollback','LOW_CTR_REVIEW',100,2,1,'rollback fixture',now()) returning id into opportunity;
 result:=public.seo_connector_internal('prepare',jsonb_build_object('opportunity_id',opportunity,'actor',a));job:=(result->>'job_id')::bigint;
 result:=public.seo_connector_internal('prepare',jsonb_build_object('opportunity_id',opportunity,'actor',a));
 if (result->>'job_id')::bigint<>job then raise exception 'Prepare duplicated job'; end if;
 insert into public.commerce_seo_content_evidence(job_id,source_url,source_hash,excerpt) values(job,'https://amphon.co.th/connector-rollback','rollback-hash',repeat('real page evidence ',10)) returning id into evidence;
 update public.commerce_seo_content_jobs set status='EVIDENCE_READY',evidence_id=evidence where id=job;
 insert into public.seo_connector_receipts(actor,site_id,query_request,result) values(a,'amphon','{"page":"https://amphon.co.th/connector-rollback","query":"connector rollback query"}','{"rows":[]}') returning id into receipt;
 args:=jsonb_build_object('actor',a,'job_id',job,'evidence_id',evidence,'receipt_id',receipt,'expected_body','','body',repeat('draft text ',15),'rationale',repeat('evidence-based rationale ',3));
 result:=public.seo_connector_internal('draft',args);
 if result->>'status'<>'EVIDENCE_READY' or exists(select 1 from public.commerce_seo_content_measurements where job_id=job) then raise exception 'Draft approved or measured prematurely'; end if;
 rejected:=false;
 begin perform public.seo_connector_internal('draft',args); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Concurrent overwrite accepted'; end if;
 args:=args||jsonb_build_object('expected_body',repeat('draft text ',15));
 update public.seo_connector_receipts set created_at=now()-interval '5 days' where id=receipt;
 rejected:=false;
 begin perform public.seo_connector_internal('draft',args); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale GSC receipt accepted'; end if;
 update public.seo_connector_receipts set created_at=now() where id=receipt;
 update public.commerce_seo_content_jobs set status='APPROVED' where id=job;
 rejected:=false;
 begin perform public.seo_connector_internal('draft',args); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Approved draft modified'; end if;
 if has_function_privilege('anon','public.seo_connector_internal(text,jsonb)','execute') or has_function_privilege('authenticated','public.seo_connector_internal(text,jsonb)','execute')
 or has_function_privilege('authenticated','public.seo_connector_gsc_context(text)','execute') then raise exception 'Internal RPC exposed'; end if;
end $$;
rollback;

-- Run against an installed migration. All fixtures and mutations roll back.
begin;
do $$ declare n integer; begin
 if private.seo_page('amphon','https://evil.example/secret') is not null then raise exception 'External URL accepted'; end if;
 if private.seo_page('amphon','http://127.0.0.1/') is not null then raise exception 'Private URL accepted'; end if;
 if private.seo_page('amphon','https://user@amphon.co.th/') is not null then raise exception 'Credentials URL accepted'; end if;
 if private.seo_page('amphon','https://www.amphon.co.th/test?token=discarded')<>'https://amphon.co.th/test' then raise exception 'URL normalization failed'; end if;
 insert into public.commerce_seo_sites(id,label,origin,gsc_property,gsc_state) values('growth-fixture','fixture.example','https://fixture.example','sc-domain:fixture.example','READY');
 insert into public.commerce_seo_network_snapshots(site_id,source_at,clicks,impressions,query_rows,queries,coverage)
 values('growth-fixture',now(),2,200,2,'[{"query":" รับซื้อ fixture ","page":"https://fixture.example/lead","clicks":1,"impressions":100,"position":5},{"query":"รับซื้อ fixture","page":"https://fixture.example/lead","clicks":1,"impressions":100,"position":5}]','SITE_TOTAL');
 perform private.refresh_seo_growth();
 select count(*) into n from public.commerce_seo_growth_opportunities where site_id='growth-fixture';
 if n<>2 then raise exception 'Expected two recommendations after normalization, got %',n; end if;
 if exists(select 1 from public.commerce_seo_growth_opportunities where site_id='growth-fixture' and impressions<>200) then raise exception 'Duplicate grouping failed'; end if;
 update public.commerce_seo_growth_opportunities set status='DISMISSED' where site_id='growth-fixture';
 perform private.refresh_seo_growth();
 if exists(select 1 from public.commerce_seo_growth_opportunities where site_id='growth-fixture' and status<>'DISMISSED') then raise exception 'Dismissed decision lost'; end if;
 if has_function_privilege('anon','public.seo_growth_manage(text,jsonb)','execute') then raise exception 'Anon RPC grant'; end if;
 if has_function_privilege('authenticated','private.refresh_seo_growth()','execute') then raise exception 'Private helper exposed'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where active and role='owner' limit 1),true);
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.commerce_seo_lead_guard_v) then raise exception 'Owner read failed'; end if;
 perform public.seo_growth_manage('owner','{"keyword":"rollback fixture keyword","site_id":"amphon","page":"https://amphon.co.th/"}');
 if not exists(select 1 from public.commerce_seo_keyword_owners where keyword='rollback fixture keyword' and confirmed) then raise exception 'Owner save failed'; end if;
 begin
 perform public.seo_growth_manage('page','{"site_id":"amphon","page":"https://evil.example/"}');
 raise exception 'External page RPC accepted';
 exception when others then if sqlerrm='External page RPC accepted' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.commerce_seo_keyword_owners) then raise exception 'Unauthenticated profile can read'; end if;
 begin perform public.seo_growth_manage('refresh'); raise exception 'Missing profile can mutate'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'SEO growth rollback, allowlist, normalization, decision retention and RLS tests passed' as verification;

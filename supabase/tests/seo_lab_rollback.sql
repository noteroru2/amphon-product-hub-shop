begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='owner' and active limit 1),true);
set local role authenticated;
do $$ declare n bigint; begin
 n:=(public.seo_lab_manage('create',jsonb_build_object('opportunity_id',(select id from public.commerce_seo_growth_opportunities where site_id='amphon' and status='OPEN' order by id limit 1)))->>'id')::bigint;
 perform set_config('test.lab_job',n::text,true);
 begin perform public.seo_lab_manage('approve',jsonb_build_object('id',n,'facts_confirmed',true));raise exception 'Approval without evidence succeeded'; exception when others then if sqlerrm='Approval without evidence succeeded' then raise; end if; end;
end $$;
reset role;
do $$ declare j public.commerce_seo_content_jobs; begin
 select * into j from public.commerce_seo_content_jobs where id=current_setting('test.lab_job')::bigint;
 perform public.seo_lab_internal('evidence',jsonb_build_object('job_id',j.id,'source_url',j.page,'source_hash','fake-test-only','excerpt',repeat('Verified test fact. ',20)));
end $$;
set local role authenticated;
do $$ declare n bigint:=current_setting('test.lab_job')::bigint; begin
 perform public.seo_lab_manage('save',jsonb_build_object('id',n,'body',repeat('Verified test fact. ',20)));
 perform public.seo_lab_manage('approve',jsonb_build_object('id',n,'facts_confirmed',true));
 if not exists(select 1 from public.commerce_seo_content_jobs where id=n and status='APPROVED') then raise exception 'Owner approval failed'; end if;
 if exists(select 1 from public.commerce_seo_content_measurements where job_id=n) then raise exception 'Approval started experiment early'; end if;
 perform public.seo_lab_manage('render_publish',jsonb_build_object('id',n,'proof_excerpt',repeat('Verified test fact. ',10),'publication_url','https://github.com/example/test/commit/'||repeat('a',40)));
 perform public.seo_lab_manage('save',jsonb_build_object('id',n,'body',repeat('Revised test fact. ',20)));
 if exists(select 1 from public.commerce_seo_content_jobs where id=n and approved_body is not null) then raise exception 'Draft edit preserved approval'; end if;
 if exists(select 1 from public.commerce_seo_content_jobs where id=n and (render_requested_at is not null or proof_excerpt is not null or render_lease_id is not null)) then raise exception 'Revision preserved old publication request'; end if;
 perform public.seo_lab_manage('approve',jsonb_build_object('id',n,'facts_confirmed',true));
 perform public.seo_lab_manage('ai_sample',jsonb_build_object('prompt_id',(select min(id) from public.commerce_seo_ai_prompts),'provider','ChatGPT','observed_at',now(),'evidence_url','https://example.com/test-only','run_status','NO_DATA','mentioned',false));
 if exists(select 1 from public.commerce_seo_ai_samples where evidence_url='https://example.com/test-only' and mentioned is not null) then raise exception 'Missing AI sample became zero visibility'; end if;
 if has_function_privilege('authenticated','public.seo_lab_internal(text,jsonb)','execute') then raise exception 'Internal helper exposed'; end if;
end $$;
reset role;
do $$ declare n bigint:=current_setting('test.lab_job')::bigint; token_value text; lease uuid:=gen_random_uuid(); begin
 perform public.seo_lab_internal('published',jsonb_build_object('job_id',n,'source_hash','fake-changed-test-only','publication_url','https://github.com/example/test/commit/'||repeat('a',40)));
 if (select count(*) from public.commerce_seo_content_measurements where job_id=n)<>3 then raise exception 'Checkpoint schedule missing'; end if;
 update public.commerce_seo_content_measurements set lease_id=lease,lease_until=now()+interval '5 minutes' where job_id=n and checkpoint_days=7;
 perform public.seo_lab_internal('finish',jsonb_build_object('job_id',n,'checkpoint_days',7,'lease_id',lease,'before_data','{"impressions":0,"position":null}'::jsonb,'after_data','{"impressions":0,"position":null}'::jsonb));
 if not exists(select 1 from public.commerce_seo_content_measurements where job_id=n and checkpoint_days=7 and verdict='INSUFFICIENT_DATA') then raise exception 'Empty GSC interpreted as improvement'; end if;
 token_value:=public.seo_lab_internal('contact','{"site_id":"shop","page":"https://shop.amphon.co.th/test-only","session":"abcdefabcdefabcdefabcdefabcdefab","channel":"UNKNOWN"}')->>'token';
 perform public.seo_lab_internal('contact','{"site_id":"shop","page":"https://shop.amphon.co.th/test-only","session":"abcdefabcdefabcdefabcdefabcdefab","channel":"UNKNOWN"}');
 if (select count(*) from public.commerce_seo_contact_events where token=token_value)<>1 then raise exception 'Contact deduplication failed'; end if;
 if exists(select 1 from public.commerce_seo_contact_events where token=token_value and (confirmed_lead or sale_id is not null)) then raise exception 'Click became lead/profit automatically'; end if;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role not in ('owner','admin') and active limit 1),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.commerce_seo_content_jobs) or exists(select 1 from public.commerce_seo_attribution_v) then raise exception 'Staff can read lab'; end if;
 begin perform public.seo_lab_manage('create','{"opportunity_id":1}');raise exception 'Staff can mutate';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Content approval, revision, delayed experiment start, missing-data handling, contact deduplication and staff-denial tests passed' as verification;

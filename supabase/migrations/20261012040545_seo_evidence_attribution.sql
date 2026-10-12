-- Evidence, approval and direct-GSC content experiments. No website/executor mutations.
create table public.commerce_seo_content_jobs (
 id bigint generated always as identity primary key,
 opportunity_id bigint not null references public.commerce_seo_growth_opportunities(id),
 site_id text not null references public.commerce_seo_sites(id), page text not null, focus_query text not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','EVIDENCE_READY','APPROVED','PUBLISHED','DISMISSED')),
 draft_body text not null default '', approved_body text, evidence_id bigint,
 approval_note text, approved_by uuid references public.profiles(id), approved_at timestamptz,
 published_at timestamptz, publication_url text, publication_hash text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index seo_content_one_active_idx on public.commerce_seo_content_jobs(opportunity_id) where status in ('DRAFT','EVIDENCE_READY','APPROVED');
create table public.commerce_seo_content_evidence (
 id bigint generated always as identity primary key, job_id bigint not null references public.commerce_seo_content_jobs(id),
 source_url text not null, source_at timestamptz not null default now(), source_hash text not null,
 page_title text, excerpt text not null check(length(excerpt)<=12000), source_kind text not null default 'PUBLIC_PAGE_HTML'
);
alter table public.commerce_seo_content_jobs add constraint seo_content_evidence_fk foreign key(evidence_id) references public.commerce_seo_content_evidence(id);
create table public.commerce_seo_content_measurements (
 job_id bigint not null references public.commerce_seo_content_jobs(id), checkpoint_days integer not null check(checkpoint_days in (7,14,28)),
 next_at timestamptz not null, lease_id uuid, lease_until timestamptz,
 attempts integer not null default 0, measured_at timestamptz, last_error text,
 before_data jsonb, after_data jsonb, windows jsonb,
 verdict text not null default 'WAITING' check(verdict in ('WAITING','INSUFFICIENT_DATA','OBSERVED_UP','OBSERVED_DOWN','NO_CLEAR_CHANGE','CONFOUNDED')),
 primary key(job_id,checkpoint_days)
);
create index seo_content_measure_due_idx on public.commerce_seo_content_measurements(next_at) where measured_at is null;
create table public.commerce_seo_ai_prompts (
 id bigint generated always as identity primary key, prompt text not null unique,
 locale text not null default 'th-TH', scope text not null default 'AMPHON network',
 provider_setup text not null default 'AWAITING_PROMPT_APPROVAL'
);
create table public.commerce_seo_ai_samples (
 id bigint generated always as identity primary key, prompt_id bigint not null references public.commerce_seo_ai_prompts(id),
 provider text not null check(provider in ('ChatGPT','Gemini','Google AI Overviews','Perplexity','Copilot','Claude')),
 observed_at timestamptz not null, evidence_url text not null,
 answer_excerpt text not null default '' check(length(answer_excerpt)<=10000),
 mentioned boolean, citations jsonb not null default '[]', cited_sites text[] not null default '{}',
 run_status text not null check(run_status in ('COMPLETED','FAILED','NO_DATA')),
 source_kind text not null default 'MANUAL_CAPTURE', created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 check((run_status='COMPLETED' and mentioned is not null) or (run_status<>'COMPLETED' and mentioned is null)),
 check(jsonb_typeof(citations)='array' and jsonb_array_length(citations)<=50),
 check(evidence_url ~ '^https://[^/@[:space:]]+'), unique(prompt_id,provider,observed_at,evidence_url)
);
create table public.commerce_seo_contact_events (
 id uuid primary key default gen_random_uuid(), token text not null unique,
 site_id text not null references public.commerce_seo_sites(id), page text not null, session_key text not null,
 event_day date not null default current_date, source_channel text not null check(source_channel in ('ORGANIC_SEARCH','AI_REFERRAL','OTHER','UNKNOWN')),
 referrer_host text, sku_hint text,
 confirmed_lead boolean not null default false, lead_reference text,
 sale_id uuid unique references public.distribution_sale_outcomes(id),
 matched_by uuid references public.profiles(id), matched_at timestamptz,
 created_at timestamptz not null default now(), unique(site_id,page,session_key,event_day)
);
create index seo_contact_session_day_idx on public.commerce_seo_contact_events(session_key,event_day);
create index seo_contact_created_idx on public.commerce_seo_contact_events(created_at);
create view public.commerce_seo_attribution_v with(security_invoker=true) as
select e.id,e.token,e.site_id,e.page,e.source_channel,e.referrer_host,e.sku_hint,e.confirmed_lead,e.lead_reference,e.created_at,e.sale_id,
 s.sku,s.actual_unit_price,s.quantity,s.actual_profit,s.sold_at,
 case when e.sale_id is not null then 'OWNER_MATCHED_SALE' when e.confirmed_lead then 'OWNER_CONFIRMED_LEAD' else 'CONTACT_CLICK_ONLY' end attribution_status
from public.commerce_seo_contact_events e left join public.distribution_sale_outcomes s on s.id=e.sale_id;

do $$ declare t text; begin foreach t in array array['commerce_seo_content_jobs','commerce_seo_content_evidence','commerce_seo_content_measurements','commerce_seo_ai_prompts','commerce_seo_ai_samples','commerce_seo_contact_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy seo_lab_admin_read on public.%I for select to authenticated using(public.current_user_role() in (''owner'',''admin''))',t);
 end loop; end $$;
grant usage,select on sequence public.commerce_seo_content_jobs_id_seq,public.commerce_seo_content_evidence_id_seq,public.commerce_seo_ai_prompts_id_seq,public.commerce_seo_ai_samples_id_seq to service_role;
revoke all on public.commerce_seo_attribution_v from anon,authenticated;
grant select on public.commerce_seo_attribution_v to authenticated,service_role;

create function public.seo_lab_manage(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; j public.commerce_seo_content_jobs; o public.commerce_seo_growth_opportunities; n bigint; sample_status text; matched public.commerce_seo_contact_events; s public.distribution_sale_outcomes;
begin
 select role into role_name from public.profiles where id=actor and active;
 if role_name is null or role_name not in ('owner','admin') then raise exception 'Owner/admin required' using errcode='42501'; end if;
 if p_action='create' then
 select * into o from public.commerce_seo_growth_opportunities where id=(p_data->>'opportunity_id')::bigint and status='OPEN' and source_at>=now()-interval '4 days';
 if o.id is null then raise exception 'Fresh open opportunity required'; end if;
 insert into public.commerce_seo_content_jobs(opportunity_id,site_id,page,focus_query) values(o.id,o.site_id,o.page,o.query)
 on conflict(opportunity_id) where status in ('DRAFT','EVIDENCE_READY','APPROVED') do nothing returning id into n;
 if n is null then select id into n from public.commerce_seo_content_jobs where opportunity_id=o.id and status in ('DRAFT','EVIDENCE_READY','APPROVED'); end if;
 return jsonb_build_object('id',n);
 elsif p_action in ('save','approve','dismiss') then
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'id')::bigint for update;
 if j.id is null or j.status in ('PUBLISHED','DISMISSED') then raise exception 'Editable job required'; end if;
 if p_action='save' then
 if length(coalesce(p_data->>'body',''))>20000 then raise exception 'Draft too long'; end if;
 update public.commerce_seo_content_jobs set draft_body=coalesce(p_data->>'body',''),status=case when evidence_id is null then 'DRAFT' else 'EVIDENCE_READY' end,
 approved_body=null,approved_at=null,approved_by=null,updated_at=now() where id=j.id;
 elsif p_action='dismiss' then update public.commerce_seo_content_jobs set status='DISMISSED',updated_at=now() where id=j.id;
 else
 if role_name<>'owner' then raise exception 'Owner approval required' using errcode='42501'; end if;
 if j.status<>'EVIDENCE_READY' or length(j.draft_body)<100 or coalesce((p_data->>'facts_confirmed')::boolean,false)=false then raise exception 'Evidence, draft and fact confirmation required'; end if;
 if not exists(select 1 from public.commerce_seo_content_evidence e where e.id=j.evidence_id and e.job_id=j.id and e.source_at>=now()-interval '7 days') then raise exception 'Fresh evidence required'; end if;
 if exists(select 1 from public.commerce_seo_lead_guard_v g where g.site_id=j.site_id and g.page=j.page and g.guard_state='CRITICAL') then raise exception 'Resolve technical warning before approval'; end if;
 update public.commerce_seo_content_jobs set status='APPROVED',approved_body=draft_body,approved_at=now(),approved_by=actor,approval_note=left(coalesce(p_data->>'note',''),1000),updated_at=now() where id=j.id;
 end if;
 elsif p_action='ai_sample' then
 sample_status:=p_data->>'run_status';
 if (p_data->>'observed_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Future AI evidence rejected'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_data->'citations','[]')) u where u !~ '^https://[^/@[:space:]]+') then raise exception 'HTTPS citation URLs required'; end if;
 insert into public.commerce_seo_ai_samples(prompt_id,provider,observed_at,evidence_url,answer_excerpt,mentioned,citations,cited_sites,run_status,created_by)
 values((p_data->>'prompt_id')::bigint,p_data->>'provider',(p_data->>'observed_at')::timestamptz,p_data->>'evidence_url',coalesce(p_data->>'answer_excerpt',''),
 case when sample_status='COMPLETED' then (p_data->>'mentioned')::boolean end,coalesce(p_data->'citations','[]'),
 array(select distinct site.id from public.commerce_seo_sites site cross join jsonb_array_elements_text(coalesce(p_data->'citations','[]')) u
 where lower(split_part(u,'/',3)) in (lower(site.label),'www.'||lower(site.label),split_part(site.origin,'/',3),'www.'||split_part(site.origin,'/',3))),sample_status,actor)
 on conflict do nothing;
 elsif p_action='lead' then
 if nullif(trim(p_data->>'lead_reference'),'') is null then raise exception 'Business case reference required'; end if;
 update public.commerce_seo_contact_events set confirmed_lead=true,lead_reference=left(trim(p_data->>'lead_reference'),100),matched_by=actor,matched_at=now() where token=p_data->>'token';
 if not found then raise exception 'Contact token not found'; end if;
 elsif p_action='sale' then
 select * into matched from public.commerce_seo_contact_events where token=p_data->>'token' for update;
 select * into s from public.distribution_sale_outcomes where id=(p_data->>'sale_id')::uuid;
 if matched.id is null or not matched.confirmed_lead or s.id is null or s.source_event_id is null or s.sold_at<matched.created_at then raise exception 'Confirmed lead and a later System sale event required'; end if;
 update public.commerce_seo_contact_events set sale_id=s.id,matched_by=actor,matched_at=now() where id=matched.id;
 elsif p_action='unlink_sale' then
 update public.commerce_seo_contact_events set sale_id=null,matched_by=actor,matched_at=now() where token=p_data->>'token';
 else raise exception 'Unknown action'; end if;
 return '{"saved":true}';
end $$;
revoke all on function public.seo_lab_manage(text,jsonb) from public,anon;
grant execute on function public.seo_lab_manage(text,jsonb) to authenticated;

create function public.seo_lab_internal(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.commerce_seo_content_jobs; n bigint; m public.commerce_seo_content_measurements; claim record; result jsonb:='[]'; before_impressions numeric; after_impressions numeric; change numeric; confounded boolean; event public.commerce_seo_contact_events; page_url text;
begin
 if p_action='evidence' then
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
end $$;
revoke all on function public.seo_lab_internal(text,jsonb) from public,anon,authenticated;
grant execute on function public.seo_lab_internal(text,jsonb) to service_role;

create function private.dispatch_seo_lab_measure() returns bigint language plpgsql set search_path='' as $$
declare key text; begin
 if not exists(select 1 from public.commerce_seo_content_measurements m join public.commerce_seo_content_jobs j on j.id=m.job_id join public.commerce_gsc_sync_jobs g on g.site_id=j.site_id join public.commerce_gsc_connections c on c.id=g.connection_id and c.state='READY' where m.measured_at is null and m.next_at<=now() and (m.lease_until is null or m.lease_until<now())) then return null; end if;
 select decrypted_secret into key from vault.decrypted_secrets where name='seo_gsc_scheduler_key';
 return net.http_post(url:='https://mfpdtlxwdbxitgfzdape.supabase.co/functions/v1/seo-workbench',headers:=jsonb_build_object('Content-Type','application/json','x-gsc-scheduler-key',key),body:='{"action":"measure"}',timeout_milliseconds:=60000);
end $$;
revoke all on function private.dispatch_seo_lab_measure() from public,anon,authenticated;
grant execute on function private.dispatch_seo_lab_measure() to service_role;
select cron.schedule('seo-content-experiment-measure','* * * * *','select private.dispatch_seo_lab_measure()');

-- Initial real opportunities, still awaiting captured evidence / individual approval.
insert into public.commerce_seo_ai_prompts(prompt) values
('ขายคอมมือสองให้ร้านไหนได้บ้างในประเทศไทย?'),
('ร้านรับซื้อโน๊ตบุ๊คมือสองที่รับประเมินจากรูปมีที่ไหนบ้าง?'),
('ร้านรับซื้อกล้องมือสองที่น่าเชื่อถือมีที่ไหนบ้าง?'),
('ขายไอโฟนมือสองให้ร้านไหนได้บ้าง?'),
('ร้านรับซื้อคอมมือสองในอุบลราชธานีมีที่ไหนบ้าง?'),
('ร้านรับซื้อสินค้าไอทีมือสองในขอนแก่นมีที่ไหนบ้าง?'),
('ร้านรับซื้อสินค้าไอทีมือสองในโคราชมีที่ไหนบ้าง?'),
('ซื้อคอมมือสองพร้อมรับประกันจากร้านไหนได้บ้าง?'),
('ซื้อโน๊ตบุ๊กมือสองจากร้านไหนได้บ้าง?'),
('มีร้านรับซื้อสินค้าไอทีมือสองพร้อมบริการรับถึงที่ไหม?');
insert into public.commerce_seo_content_jobs(opportunity_id,site_id,page,focus_query)
select id,site_id,page,query from (select distinct on(site_id) * from public.commerce_seo_growth_opportunities where status='OPEN' and query ~ '(รับซื้อ|มือสอง)' and source_at>=now()-interval '4 days' order by site_id,priority desc,impressions desc) x order by priority desc limit 6;

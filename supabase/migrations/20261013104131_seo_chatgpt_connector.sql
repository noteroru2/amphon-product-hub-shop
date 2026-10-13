-- Scoped ChatGPT OAuth: SEO reads and unapproved drafts only.
create table public.seo_connector_clients (
 id uuid primary key default gen_random_uuid(), name text not null, redirects jsonb not null,
 created_at timestamptz not null default now()
);
create table public.seo_connector_requests (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.seo_connector_clients(id),
 redirect_uri text not null, state text not null, challenge text not null, actor uuid references public.profiles(id),
 code_hash text unique, scopes text not null default 'seo:read seo:draft', expires_at timestamptz not null default now()+interval '10 minutes', consumed boolean not null default false
);
create table public.seo_connector_tokens (
 access_hash text primary key, refresh_hash text unique not null, client_id uuid not null references public.seo_connector_clients(id),
 actor uuid not null references public.profiles(id), expires_at timestamptz not null default now()+interval '1 hour',
 refresh_until timestamptz not null default now()+interval '30 days', scopes text not null default 'seo:read seo:draft', revoked boolean not null default false, created_at timestamptz not null default now()
);
create table public.seo_connector_receipts (
 id uuid primary key default gen_random_uuid(), actor uuid not null references public.profiles(id), site_id text not null references public.commerce_seo_sites(id),
 query_request jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table public.commerce_seo_content_jobs add column analysis_receipt_id uuid references public.seo_connector_receipts(id), add column analysis_note text, add column analysis_by uuid references public.profiles(id);
create table public.seo_connector_draft_revisions (
 id bigint generated always as identity primary key, job_id bigint not null references public.commerce_seo_content_jobs(id),
 actor uuid not null references public.profiles(id), evidence_id bigint not null references public.commerce_seo_content_evidence(id),
 receipt_id uuid not null references public.seo_connector_receipts(id), body text not null, rationale text not null, created_at timestamptz not null default now()
);
do $$ declare t text; begin foreach t in array array['seo_connector_clients','seo_connector_requests','seo_connector_tokens','seo_connector_receipts','seo_connector_draft_revisions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop; end $$;
grant usage,select on sequence public.seo_connector_draft_revisions_id_seq to service_role;
grant select on public.seo_connector_receipts to authenticated;
create policy seo_receipt_owner_read on public.seo_connector_receipts for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and active and role='owner'));

create function public.seo_connector_internal(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.seo_connector_clients; r public.seo_connector_requests; t public.seo_connector_tokens; a uuid; j public.commerce_seo_content_jobs; o public.commerce_seo_growth_opportunities; e public.commerce_seo_content_evidence; receipt public.seo_connector_receipts;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Service only' using errcode='42501'; end if;
 if p_action='register' then
 if (select count(*) from public.seo_connector_clients where created_at>now()-interval '1 day')>=100 then raise exception 'Registration limit'; end if;
 insert into public.seo_connector_clients(name,redirects) values(left(p_data->>'name',100),p_data->'redirects') returning * into c;
 return jsonb_build_object('client_id',c.id);
 elsif p_action='start' then
 select * into c from public.seo_connector_clients where id=(p_data->>'client_id')::uuid;
 if c.id is null or not c.redirects ? (p_data->>'redirect_uri') then raise exception 'Registered redirect required'; end if;
 if (select count(*) from public.seo_connector_requests where expires_at>now())>=500 then raise exception 'Authorization request limit'; end if;
 insert into public.seo_connector_requests(client_id,redirect_uri,state,challenge,scopes) values(c.id,p_data->>'redirect_uri',p_data->>'state',p_data->>'challenge',p_data->>'scopes') returning * into r;
 return jsonb_build_object('id',r.id);
 elsif p_action in ('request','consent') then
 a:=(p_data->>'actor')::uuid;
 if not exists(select 1 from public.profiles where id=a and active and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 select * into r from public.seo_connector_requests where id=(p_data->>'id')::uuid and expires_at>now() and not consumed and code_hash is null for update;
 if r.id is null then raise exception 'Request expired'; end if;
 if p_action='request' then return jsonb_build_object('name',(select name from public.seo_connector_clients where id=r.client_id),'redirect_uri',r.redirect_uri,'scopes',r.scopes); end if;
 update public.seo_connector_requests set actor=a,code_hash=p_data->>'code_hash' where id=r.id;
 return jsonb_build_object('redirect_uri',r.redirect_uri,'state',r.state);
 elsif p_action='exchange' then
 if p_data->>'grant_type'='authorization_code' then
 select * into r from public.seo_connector_requests where code_hash=p_data->>'code_hash' and expires_at>now() and not consumed for update;
 if r.id is null or r.client_id::text is distinct from p_data->>'client_id' or r.redirect_uri is distinct from p_data->>'redirect_uri' or r.challenge is distinct from p_data->>'challenge' then return null; end if;
 a:=r.actor;
 update public.seo_connector_requests set consumed=true where id=r.id;
 else
 select * into t from public.seo_connector_tokens where refresh_hash=p_data->>'refresh_hash' and not revoked and refresh_until>now() for update;
 if t.access_hash is null or t.client_id::text is distinct from p_data->>'client_id' then return null; end if;
 a:=t.actor;
 update public.seo_connector_tokens set revoked=true where access_hash=t.access_hash;
 end if;
 if not exists(select 1 from public.profiles where id=a and active and role='owner') then return null; end if;
 insert into public.seo_connector_tokens(access_hash,refresh_hash,client_id,actor,scopes) values(p_data->>'access_hash',p_data->>'new_refresh_hash',(p_data->>'client_id')::uuid,a,coalesce(r.scopes,t.scopes));
 return jsonb_build_object('actor',a,'scopes',coalesce(r.scopes,t.scopes));
 elsif p_action='auth' then
 select * into t from public.seo_connector_tokens where access_hash=p_data->>'hash' and not revoked and expires_at>now();
 if t.actor is null or not exists(select 1 from public.profiles where id=t.actor and active and role='owner') then return null; end if;
 return jsonb_build_object('actor',t.actor,'scopes',t.scopes);
 elsif p_action='revoke' then
 update public.seo_connector_tokens set revoked=true where access_hash=p_data->>'hash' or refresh_hash=p_data->>'hash'; return '{}';
 elsif p_action='revoke_all' then
 a:=(p_data->>'actor')::uuid;
 update public.seo_connector_tokens set revoked=true where actor=a; return '{"revoked":true}';
 elsif p_action in ('prepare','draft') then
 a:=(p_data->>'actor')::uuid;
 if not exists(select 1 from public.profiles where id=a and active and role='owner') then raise exception 'Owner required' using errcode='42501'; end if;
 if p_action='prepare' then
 select * into o from public.commerce_seo_growth_opportunities where id=(p_data->>'opportunity_id')::bigint and status='OPEN' and source_at>=now()-interval '4 days';
 if o.id is null then raise exception 'Fresh open opportunity required'; end if;
 insert into public.commerce_seo_content_jobs(opportunity_id,site_id,page,focus_query) values(o.id,o.site_id,o.page,o.query)
 on conflict(opportunity_id) where status in ('DRAFT','EVIDENCE_READY','APPROVED') do nothing;
 select * into j from public.commerce_seo_content_jobs where opportunity_id=o.id and status in ('DRAFT','EVIDENCE_READY','APPROVED');
 return jsonb_build_object('job_id',j.id,'status',j.status,'evidence_id',j.evidence_id,'next','Read seo_job_evidence; rendered evidence is captured by the existing worker.');
 end if;
 select * into j from public.commerce_seo_content_jobs where id=(p_data->>'job_id')::bigint for update;
 if j.id is null or j.status<>'EVIDENCE_READY' then raise exception 'Unapproved evidence-ready job required'; end if;
 if p_data->>'expected_body' is distinct from j.draft_body or j.evidence_id is distinct from (p_data->>'evidence_id')::bigint then raise exception 'Draft or evidence changed; reload'; end if;
 select * into e from public.commerce_seo_content_evidence where id=j.evidence_id and job_id=j.id and source_at>now()-interval '7 days';
 select * into receipt from public.seo_connector_receipts where id=(p_data->>'receipt_id')::uuid and actor=a and site_id=j.site_id and created_at>now()-interval '4 days';
 if e.id is null or receipt.id is null or receipt.query_request->>'page' is distinct from j.page or receipt.query_request->>'query' is distinct from j.focus_query then raise exception 'Fresh matching page/query evidence required'; end if;
 if length(coalesce(p_data->>'body','')) not between 100 and 20000 or length(coalesce(p_data->>'rationale','')) not between 30 and 3000 then raise exception 'Draft and analysis rationale required'; end if;
 update public.commerce_seo_content_jobs set draft_body=p_data->>'body',analysis_receipt_id=receipt.id,analysis_note=p_data->>'rationale',analysis_by=a,updated_at=now(),
 approved_body=null,approved_at=null,approved_by=null,render_requested_at=null,render_lease_id=null,render_lease_until=null,proof_excerpt=null,requested_commit_url=null where id=j.id;
 insert into public.seo_connector_draft_revisions(job_id,actor,evidence_id,receipt_id,body,rationale) values(j.id,a,e.id,receipt.id,p_data->>'body',p_data->>'rationale');
 return jsonb_build_object('job_id',j.id,'status','EVIDENCE_READY','next','Owner must review and approve the exact draft in Hub.');
 else raise exception 'Unknown connector action'; end if;
end $$;
revoke all on function public.seo_connector_internal(text,jsonb) from public,anon,authenticated;
grant execute on function public.seo_connector_internal(text,jsonb) to service_role;

-- Only the server can resolve the connection's Vault secret for a registered site.
create function public.seo_connector_gsc_context(p_site text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('property',g.property,'refresh_token',v.decrypted_secret,'origin',s.origin)
 from public.commerce_gsc_sync_jobs g join public.commerce_gsc_connections c on c.id=g.connection_id and c.state='READY'
 join public.commerce_seo_sites s on s.id=g.site_id and s.enabled join vault.decrypted_secrets v on v.id=c.token_secret_id where g.site_id=p_site;
$$;
revoke all on function public.seo_connector_gsc_context(text) from public,anon,authenticated;
grant execute on function public.seo_connector_gsc_context(text) to service_role;

-- A subsequent manual edit clears the prior analysis association.
do $$ declare definition text; anchor text:='approved_body=null,approved_at=null,approved_by=null,render_requested_at=null'; begin
 select pg_get_functiondef('public.seo_lab_manage(text,jsonb)'::regprocedure) into definition;
 if strpos(definition,anchor)=0 then raise exception 'Draft save anchor missing'; end if;
 execute replace(definition,anchor,'analysis_receipt_id=null,analysis_note=null,analysis_by=null,'||anchor);
end $$;

-- PROPOSED ONLY. Applied exclusively to disposable synthetic Local Supabase QA.
-- Reservations never expire automatically. Only authenticated active Owners may
-- approve a quiescent takeover or an exact irreversible delete. No R2 grants.
create schema if not exists evidence_internal;
revoke all on schema evidence_internal from public, anon, authenticated;
grant usage on schema evidence_internal to service_role, authenticated;
create table evidence_internal.media (
 key text primary key check(key ~ '^evidence/[0-9a-f-]{36}/[0-9a-f-]{36}[.]webp$'),
 busy uuid, tombstone boolean not null default false,
 sha256 text, etag text, written_at timestamptz, consent_at timestamptz,
 terminal_at timestamptz not null default now()
);
create table evidence_internal.operations (
 id uuid primary key default gen_random_uuid(), op_key text unique not null,
 kind text not null check(kind in ('STAGE','PR','DELETE')), key text not null references evidence_internal.media(key),
 request_id uuid, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 digest text, consent_at timestamptz, approval_id uuid, token uuid not null,
 state text not null default 'RUNNING' check(state in ('RUNNING','UNCERTAIN','DONE','BLOCKED')), recovered boolean not null default false,
 checkpoints jsonb not null default '{}', created_at timestamptz not null default now()
);
create table evidence_internal.approvals (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('RECOVER','DELETE')),
 key text not null references evidence_internal.media(key), operation_id uuid,
 etag text, owner_id uuid not null, owner_session uuid not null, quiescent boolean not null default false,
 created_at timestamptz not null default now(), revoked_at timestamptz,
 expires_at timestamptz not null default now()+interval '15 minutes', used boolean not null default false
);
create table evidence_internal.audit (
 id bigint generated always as identity primary key, operation_id uuid,
 event text not null, at timestamptz not null default now()
);
create table evidence_internal.policy (
 id boolean primary key default true check(id), cleanup_enabled boolean not null default false,
 retention_seconds integer not null default 604800 check(retention_seconds>=86400)
);
create index evidence_active_media_references on public.commerce_evidence_publication_requests(private_media_key)
 where status<>'CANCELLED';
create index evidence_operation_audit_order on evidence_internal.audit(operation_id,id);
create index evidence_operations_by_request on evidence_internal.operations(request_id);
insert into evidence_internal.policy(id) values(true);
alter table evidence_internal.media enable row level security;
alter table evidence_internal.operations enable row level security;
alter table evidence_internal.approvals enable row level security;
alter table evidence_internal.audit enable row level security;
alter table evidence_internal.policy enable row level security;
revoke all on all tables in schema evidence_internal from public, anon, authenticated, service_role;

create function evidence_internal.queue_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare k text; m evidence_internal.media;
begin
 if tg_op='UPDATE' and (new.private_media_key,new.image_id,new.evidence_id) is distinct from
   (old.private_media_key,old.image_id,old.evidence_id) then raise exception 'EVIDENCE_IDENTITY_IMMUTABLE'; end if;
 k:=case when tg_op='DELETE' then old.private_media_key else new.private_media_key end;
 insert into evidence_internal.media(key) values(k) on conflict do nothing;
 select * into m from evidence_internal.media where key=k for update;
 if tg_op<>'DELETE' and m.tombstone and (tg_op='INSERT' or new.status<>'CANCELLED') then
  raise exception 'EVIDENCE_KEY_RETIRED'; end if;
 if tg_op='DELETE' or new.status='CANCELLED' then
  update evidence_internal.media set terminal_at=now() where key=k;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger evidence_recovery_queue_guard before insert or update or delete
on public.commerce_evidence_publication_requests for each row execute function evidence_internal.queue_guard();
insert into evidence_internal.media(key) select distinct private_media_key from public.commerce_evidence_publication_requests on conflict do nothing;

create function evidence_internal.live_session() returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
$$;
create function evidence_internal.approval_active(a evidence_internal.approvals) returns boolean language sql security definer set search_path='' as $$
 select a.id is not null and a.quiescent and a.revoked_at is null and a.expires_at>now()
  and exists(select 1 from public.profiles u where u.id=a.owner_id and u.role='owner' and u.active)
  and exists(select 1 from auth.sessions s where s.id=a.owner_session and s.user_id=a.owner_id and (s.not_after is null or s.not_after>now()))
$$;

create function evidence_internal.approve(p_kind text,p_key text,p_operation uuid,p_etag text,p_quiescent boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role='owner' and active)
  then raise exception 'EVIDENCE_OWNER_REQUIRED'; end if;
 if not evidence_internal.live_session() then raise exception 'EVIDENCE_LIVE_SESSION_REQUIRED'; end if;
 if not p_quiescent then raise exception 'EVIDENCE_QUIESCENCE_REQUIRED'; end if;
 if p_kind='RECOVER' and not exists(select 1 from evidence_internal.operations where id=p_operation and key=p_key and state in ('RUNNING','UNCERTAIN'))
  then raise exception 'EVIDENCE_RECOVERY_NOT_FOUND'; end if;
 if p_kind='DELETE' and (p_etag is null or not exists(select 1 from evidence_internal.media where key=p_key and etag=p_etag))
  then raise exception 'EVIDENCE_ETAG_REQUIRED'; end if;
 insert into evidence_internal.approvals(kind,key,operation_id,etag,owner_id,owner_session,quiescent)
 values(p_kind,p_key,p_operation,p_etag,auth.uid(),(auth.jwt()->>'session_id')::uuid,true) returning id into result;
 return result;
end $$;
create function public.evidence_owner_approve(p_kind text,p_key text,p_operation uuid default null,p_etag text default null,p_quiescent boolean default false)
returns uuid language sql security invoker set search_path='' as $$
 select evidence_internal.approve(p_kind,p_key,p_operation,p_etag,p_quiescent)
$$;

create function evidence_internal.operation(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o evidence_internal.operations; m evidence_internal.media; a evidence_internal.approvals;
 r public.commerce_evidence_publication_requests; approved timestamptz; valid boolean; phase text;
begin
 if p_action='lookup' then
  select * into o from evidence_internal.operations where op_key=p->>'op_key';
  return case when o.id is null then null else to_jsonb(o)-'token' end;
 end if;
 if p_action='lookup_request' then
  return coalesce((select jsonb_agg(to_jsonb(operation_row)-'token' order by operation_row.created_at)
   from evidence_internal.operations operation_row where operation_row.request_id=(p->>'request_id')::uuid),'[]'::jsonb);
 end if;
 if p_action='audit' then
  return coalesce((select jsonb_agg(jsonb_build_object('event',entry.event,'at',entry.at) order by entry.id)
   from evidence_internal.audit entry where entry.operation_id=(p->>'id')::uuid),'[]'::jsonb);
 end if;
 if p_action='begin' then
  if p->>'token' is null then raise exception 'EVIDENCE_EXECUTOR_TOKEN_REQUIRED'; end if;
  if (p->>'op_key') is distinct from (case when p->>'kind'='PR' then 'PR:'||(p->>'request_id') else (p->>'kind')||':'||(p->>'key') end)
   then raise exception 'EVIDENCE_IDEMPOTENCY_KEY_INVALID'; end if;
  insert into evidence_internal.media(key) values(p->>'key') on conflict do nothing;
  select * into m from evidence_internal.media where key=p->>'key' for update;
  select * into o from evidence_internal.operations where op_key=p->>'op_key' for update;
  if found then
   if o.fingerprint is distinct from p->>'fingerprint' or o.key is distinct from p->>'key' or o.kind is distinct from p->>'kind'
    then raise exception 'EVIDENCE_OPERATION_CONFLICT'; end if;
   if o.state='DONE' then return to_jsonb(o); end if;
   if o.state='BLOCKED' then raise exception 'EVIDENCE_OPERATION_BLOCKED'; end if;
   if o.token is distinct from (p->>'token')::uuid then
    select * into a from evidence_internal.approvals where id=(p->>'approval')::uuid for update;
    if a.id is null or a.kind<>'RECOVER' or a.operation_id<>o.id or a.key<>o.key or a.used or not evidence_internal.approval_active(a)
     then raise exception 'EVIDENCE_OPERATION_BUSY_QUIESCENT_OWNER_RECOVERY_REQUIRED'; end if;
    update evidence_internal.approvals set used=true where id=a.id;
    if o.kind='DELETE' then
     select * into a from evidence_internal.approvals where id=(p->>'delete_approval')::uuid for update;
     if a.id is null or a.kind<>'DELETE' or a.key<>o.key or a.etag is distinct from m.etag or a.used or not evidence_internal.approval_active(a)
      then raise exception 'EVIDENCE_FRESH_DELETE_APPROVAL_REQUIRED'; end if;
     update evidence_internal.approvals set used=true where id=a.id;
     update evidence_internal.operations set approval_id=a.id where id=o.id;
    end if;
    update evidence_internal.operations set token=(p->>'token')::uuid,state='RUNNING',recovered=true where id=o.id returning * into o;
    insert into evidence_internal.audit(operation_id,event) values(o.id,'OWNER_QUIESCENT_RECOVERY');
   end if;
   return to_jsonb(o);
  end if;
  if m.busy is not null then raise exception 'EVIDENCE_KEY_BUSY'; end if;
  if m.tombstone then raise exception 'EVIDENCE_KEY_RETIRED'; end if;
  if p->>'kind'='DELETE' then
   if not (select cleanup_enabled from evidence_internal.policy where id) then raise exception 'EVIDENCE_CLEANUP_DISABLED'; end if;
   select * into a from evidence_internal.approvals where id=(p->>'approval')::uuid for update;
   if a.id is null or a.kind<>'DELETE' or a.key<>m.key or a.etag is distinct from m.etag or a.used or not evidence_internal.approval_active(a)
    then raise exception 'EVIDENCE_DELETE_OWNER_APPROVAL_REQUIRED'; end if;
   if exists(select 1 from public.commerce_evidence_publication_requests where private_media_key=m.key and status<>'CANCELLED')
    then raise exception 'EVIDENCE_ACTIVE_REFERENCE'; end if;
   if m.written_at is null or greatest(m.written_at,m.terminal_at) > now()-
     make_interval(secs=>(select retention_seconds from evidence_internal.policy where id)) then raise exception 'EVIDENCE_RETENTION_HOLD'; end if;
   update evidence_internal.approvals set used=true where id=a.id;
   update evidence_internal.media set tombstone=true where key=m.key;
  else
   select * into r from public.commerce_evidence_publication_requests where id=(p->>'request_id')::uuid;
   if r.id is null or r.private_media_key<>m.key or r.status<>'PENDING_SOURCE_PR' then raise exception 'EVIDENCE_QUEUE_REQUIRED'; end if;
   select e.approved_at into approved from public.trade_evidence e join public.trade_evidence_images i on i.evidence_id=e.id
    join public.profiles u on u.id=r.requested_by where e.id=r.evidence_id and i.id=r.image_id
    and e.status='APPROVED' and e.permission_confirmed and e.privacy_reviewed and i.approved_for_public and u.role='owner' and u.active;
   if approved is null then raise exception 'EVIDENCE_CONSENT_REQUIRED'; end if;
   if p->>'kind'='PR' and (m.sha256 is null or m.consent_at is distinct from approved) then raise exception 'EVIDENCE_STAGING_REQUIRED'; end if;
  end if;
  insert into evidence_internal.operations(op_key,kind,key,request_id,fingerprint,digest,consent_at,approval_id,token,checkpoints)
   values(p->>'op_key',p->>'kind',m.key,(p->>'request_id')::uuid,p->>'fingerprint',coalesce(p->>'digest',m.sha256),approved,a.id,(p->>'token')::uuid,
    case when p->>'kind'='DELETE' then jsonb_build_object('object',jsonb_build_object('etag',m.etag,'sha256',m.sha256)) else '{}'::jsonb end) returning * into o;
  update evidence_internal.media set busy=o.id where key=m.key;
  insert into evidence_internal.audit(operation_id,event) values(o.id,'INTENT_RECORDED');
  return to_jsonb(o);
 end if;
 select * into o from evidence_internal.operations where id=(p->>'id')::uuid;
 if o.id is null then raise exception 'EVIDENCE_OPERATION_MISSING'; end if;
 -- Queue updates acquire their row lock before the media trigger. Follow that
 -- same order when committing a PR receipt to avoid cancellation deadlocks.
 if p_action='finish' and o.kind='PR' then
  perform 1 from public.commerce_evidence_publication_requests where id=o.request_id for update;
 end if;
 select * into m from evidence_internal.media where key=o.key for update;
 select * into o from evidence_internal.operations where id=o.id for update;
 if p_action='inspect' then return to_jsonb(o)-'token'; end if;
 if o.token is distinct from (p->>'token')::uuid or o.state<>'RUNNING' or m.busy is distinct from o.id then raise exception 'EVIDENCE_OPERATION_FENCED'; end if;
 if p_action='uncertain' then
  update evidence_internal.operations set state='UNCERTAIN' where id=o.id returning * into o;
  insert into evidence_internal.audit(operation_id,event) values(o.id,'UNCERTAIN_HELD');
  return to_jsonb(o);
 end if;
 if o.kind='DELETE' then
  valid:=not exists(select 1 from public.commerce_evidence_publication_requests where private_media_key=o.key and status<>'CANCELLED')
   and exists(select 1 from evidence_internal.approvals approval_row where approval_row.id=o.approval_id and evidence_internal.approval_active(approval_row))
   and (select cleanup_enabled from evidence_internal.policy where id)
   and m.tombstone and m.written_at is not null and greatest(m.written_at,m.terminal_at)<=now()-
    make_interval(secs=>(select retention_seconds from evidence_internal.policy where id));
 else
  select exists(select 1 from public.commerce_evidence_publication_requests q join public.trade_evidence e on e.id=q.evidence_id
   join public.trade_evidence_images i on i.id=q.image_id join public.profiles u on u.id=q.requested_by
   where q.id=o.request_id and q.status='PENDING_SOURCE_PR' and e.status='APPROVED' and e.permission_confirmed and e.privacy_reviewed
   and e.approved_at=o.consent_at and i.evidence_id=e.id and i.approved_for_public and u.role='owner' and u.active) into valid;
 end if;
 if p_action='assert' then
  if not valid then raise exception 'EVIDENCE_AUTHORIZATION_STALE'; end if;
  return to_jsonb(o);
 end if;
 if p_action='checkpoint' then
  phase:=p->>'phase';
  if phase not in ('object','tree','commit','branch','pr','absent','target') or octet_length((p->'value')::text)>4096 then raise exception 'EVIDENCE_CHECKPOINT_INVALID'; end if;
  if o.checkpoints ? phase and o.checkpoints->phase is distinct from p->'value' then raise exception 'EVIDENCE_CHECKPOINT_IMMUTABLE'; end if;
  update evidence_internal.operations set checkpoints=jsonb_set(checkpoints,array[phase],p->'value') where id=o.id returning * into o;
  insert into evidence_internal.audit(operation_id,event) values(o.id,'CHECKPOINT_'||upper(phase));
  return to_jsonb(o);
 end if;
 if p_action='abandon' then
  if o.kind<>'PR' or not o.recovered or o.checkpoints->'absent' is distinct from 'true'::jsonb then raise exception 'EVIDENCE_QUIESCENT_ABSENCE_REQUIRED'; end if;
  update evidence_internal.operations set state='BLOCKED' where id=o.id returning * into o;
  update evidence_internal.media set busy=null where key=o.key;
  insert into evidence_internal.audit(operation_id,event) values(o.id,'ABSENCE_RECONCILED_BLOCKED');
  return to_jsonb(o);
 end if;
 if p_action='finish' then
  if o.kind='DELETE' and o.checkpoints->'absent' is distinct from 'true'::jsonb then raise exception 'EVIDENCE_DELETE_NOT_VERIFIED'; end if;
  if o.kind='STAGE' then
   if o.checkpoints->'object' is null then raise exception 'EVIDENCE_OBJECT_NOT_VERIFIED'; end if;
   update evidence_internal.media set sha256=o.digest,etag=o.checkpoints->'object'->>'etag',written_at=now(),consent_at=o.consent_at where key=o.key;
  end if;
  if o.kind='PR' and valid then
   if o.checkpoints->'pr' is null then raise exception 'EVIDENCE_PR_NOT_VERIFIED'; end if;
   update public.commerce_evidence_publication_requests set status='DRAFT_PR_OPEN',draft_pr_number=(o.checkpoints->'pr'->>'number')::int,
    draft_pr_url=o.checkpoints->'pr'->>'url',draft_commit_sha=o.checkpoints->>'commit' where id=o.request_id and status='PENDING_SOURCE_PR';
   if not found then raise exception 'EVIDENCE_QUEUE_STATE_CHANGED'; end if;
  end if;
  update evidence_internal.operations set state=case when valid or o.kind='STAGE' then 'DONE' else 'BLOCKED' end where id=o.id returning * into o;
  update evidence_internal.media set busy=null where key=o.key;
  insert into evidence_internal.audit(operation_id,event) values(o.id,case when valid then o.state else o.state||'_AUTHORIZATION_REVOKED' end);
  return to_jsonb(o)||jsonb_build_object('authorization_valid',valid);
 end if;
 raise exception 'EVIDENCE_ACTION_INVALID';
end $$;
create function public.evidence_operation(p_action text,p jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select evidence_internal.operation(p_action,p)
$$;
revoke all on all functions in schema evidence_internal from public,anon,authenticated,service_role;
grant execute on function evidence_internal.operation(text,jsonb) to service_role;
grant execute on function evidence_internal.approve(text,text,uuid,text,boolean) to authenticated;
revoke all on function public.evidence_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.evidence_operation(text,jsonb) to service_role;
revoke all on function public.evidence_owner_approve(text,text,uuid,text,boolean) from public,anon,service_role;
grant execute on function public.evidence_owner_approve(text,text,uuid,text,boolean) to authenticated;

create function evidence_internal.source_access(p_image uuid,p_purpose text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.trade_evidence; i public.trade_evidence_images; u public.profiles;
begin
 select * into u from public.profiles where id=auth.uid();
 if u.id is null or not u.active or u.role not in ('owner','admin') or not evidence_internal.live_session() or p_purpose not in ('PREVIEW','EXPORT') then raise exception 'EVIDENCE_ACCESS_DENIED'; end if;
 select * into i from public.trade_evidence_images where id=p_image;
 select * into e from public.trade_evidence where id=i.evidence_id;
 if e.id is null or not e.permission_confirmed or e.status='ARCHIVED' or i.storage_path not like e.id::text||'/%' then raise exception 'EVIDENCE_CONSENT_REVOKED'; end if;
 if p_purpose='EXPORT' and (u.role<>'owner' or e.status<>'APPROVED' or not e.privacy_reviewed or not i.approved_for_public or e.approved_at is null)
  then raise exception 'EVIDENCE_EXPORT_REVIEW_REQUIRED'; end if;
 return jsonb_build_object('storage_path',i.storage_path,'version',jsonb_build_array(u.id,u.role,u.active,e.id,e.status,
  e.permission_confirmed,e.privacy_reviewed,e.approved_at,i.id,i.approved_for_public,i.storage_path));
end $$;
create function public.evidence_private_access(p_image uuid,p_purpose text) returns jsonb language sql security invoker set search_path='' as $$
 select evidence_internal.source_access(p_image,p_purpose)
$$;
create function evidence_internal.source_read_allowed(p_path text) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.profiles u,public.trade_evidence e join public.trade_evidence_images i on i.evidence_id=e.id
  where u.id=auth.uid() and u.active and u.role in ('owner','admin') and i.storage_path=p_path and i.storage_path like e.id::text||'/%'
   and e.permission_confirmed and e.status<>'ARCHIVED' and evidence_internal.live_session())
$$;
create function evidence_internal.source_operator() returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role in ('owner','admin')) and evidence_internal.live_session()
$$;
revoke all on function evidence_internal.source_access(uuid,text), evidence_internal.source_read_allowed(text), evidence_internal.source_operator() from public,anon,service_role;
grant execute on function evidence_internal.source_access(uuid,text), evidence_internal.source_read_allowed(text), evidence_internal.source_operator() to authenticated;
revoke all on function public.evidence_private_access(uuid,text) from public,anon,service_role;
grant execute on function public.evidence_private_access(uuid,text) to authenticated;
create function evidence_internal.source_list_allowed(p_path text) returns boolean
language sql security definer set search_path='' as $$
 select evidence_internal.source_operator() and exists(select 1 from public.trade_evidence e where p_path like e.id::text||'/%')
$$;
revoke all on function evidence_internal.source_list_allowed(text) from public,anon,service_role;
grant execute on function evidence_internal.source_list_allowed(text) to authenticated;
-- Prevent legacy permissive policies from allowing new signed URLs or downloads
-- after consent withdrawal. Preserve separately authorized erasure operations.
create policy evidence_source_private_boundary on storage.objects as restrictive for select to authenticated
using(bucket_id<>'trade-evidence-private' or
 (storage.allow_only_operation('object.list') and evidence_internal.source_list_allowed(name)) or
 (storage.allow_any_operation(array['object.delete','object.delete_many']) and evidence_internal.source_operator()) or
 (storage.allow_only_operation('object.get_authenticated') and evidence_internal.source_read_allowed(name)));
create policy evidence_source_private_read on storage.objects for select to authenticated
using(bucket_id='trade-evidence-private' and
 ((storage.allow_only_operation('object.list') and evidence_internal.source_list_allowed(name)) or
 (storage.allow_any_operation(array['object.delete','object.delete_many']) and evidence_internal.source_operator()) or
 (storage.allow_only_operation('object.get_authenticated') and evidence_internal.source_read_allowed(name))));
create policy evidence_source_anon_denial on storage.objects as restrictive for select to anon using(bucket_id<>'trade-evidence-private');

create function evidence_internal.revoke_approval(p_approval uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not evidence_internal.live_session() or not exists(select 1 from public.profiles where id=auth.uid() and role='owner' and active)
  then raise exception 'EVIDENCE_OWNER_REQUIRED'; end if;
 update evidence_internal.approvals set revoked_at=now() where id=p_approval and owner_id=auth.uid();
 if not found then raise exception 'EVIDENCE_APPROVAL_NOT_FOUND'; end if;
end $$;
create function public.evidence_owner_revoke_approval(p_approval uuid) returns void language sql security invoker set search_path='' as $$
 select evidence_internal.revoke_approval(p_approval)
$$;
revoke all on function evidence_internal.revoke_approval(uuid),public.evidence_owner_revoke_approval(uuid) from public,anon,service_role;
grant execute on function evidence_internal.revoke_approval(uuid),public.evidence_owner_revoke_approval(uuid) to authenticated;

begin;
alter table public.ai_buyer_pb28_drafts drop constraint if exists ai_buyer_pb28_drafts_status_check;
alter table public.ai_buyer_pb28_drafts add constraint ai_buyer_pb28_drafts_status_check
 check (status in ('DRAFT','FROZEN','ARCHIVED'));
alter table public.ai_buyer_pb28_audit drop constraint if exists ai_buyer_pb28_audit_action_check;
alter table public.ai_buyer_pb28_audit add constraint ai_buyer_pb28_audit_action_check
 check (action in ('CREATE_DRAFT','CLONE_DRAFT','UPDATE_DRAFT','FREEZE_DRAFT','REOPEN_DRAFT','ARCHIVE_DRAFT',
 'CREATE_ENTRY','UPDATE_ENTRY','DELETE_ENTRY','BULK_EDIT','IMPORT_ENTRIES'));
create or replace function public.ai_buyer_pb28_manage_draft(p_draft_id uuid,p_action text,p_title text default null)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid; existing public.ai_buyer_pb28_drafts%rowtype; updated public.ai_buyer_pb28_drafts%rowtype;
begin
 actor:=public.ai_buyer_pb28_require_admin();
 select * into existing from public.ai_buyer_pb28_drafts where id=p_draft_id for update;
 if not found then raise exception 'PB28_DRAFT_NOT_FOUND'; end if;
 if existing.status='ARCHIVED' then raise exception 'PB28_ARCHIVED_IMMUTABLE'; end if;
 if p_action='RENAME' and existing.status='DRAFT' then
  if length(btrim(coalesce(p_title,''))) not between 3 and 160 then raise exception 'PB28_TITLE_INVALID'; end if;
  update public.ai_buyer_pb28_drafts set title=btrim(p_title),updated_at=now() where id=p_draft_id returning * into updated;
 elsif p_action='FREEZE' and existing.status='DRAFT' then
  update public.ai_buyer_pb28_drafts set status='FROZEN',updated_at=now() where id=p_draft_id returning * into updated;
 elsif p_action='REOPEN' and existing.status='FROZEN' then
  update public.ai_buyer_pb28_drafts set status='DRAFT',updated_at=now() where id=p_draft_id returning * into updated;
 elsif p_action='ARCHIVE' and existing.status in ('DRAFT','FROZEN') then
  update public.ai_buyer_pb28_drafts set status='ARCHIVED',updated_at=now() where id=p_draft_id returning * into updated;
 else raise exception 'PB28_INVALID_STATE_TRANSITION'; end if;
 insert into public.ai_buyer_pb28_audit(draft_id,actor_id,action,before_data,after_data)
 values(p_draft_id,actor,case p_action when 'RENAME' then 'UPDATE_DRAFT' else p_action||'_DRAFT' end,
  to_jsonb(existing),to_jsonb(updated));
 return updated.status;
end; $$;
revoke all on function public.ai_buyer_pb28_manage_draft(uuid,text,text) from public,anon;
grant execute on function public.ai_buyer_pb28_manage_draft(uuid,text,text) to authenticated;
commit;
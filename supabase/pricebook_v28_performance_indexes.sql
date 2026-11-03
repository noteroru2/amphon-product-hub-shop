create index if not exists pb28_drafts_creator_idx on public.ai_buyer_pb28_drafts(created_by);
create index if not exists pb28_drafts_source_idx on public.ai_buyer_pb28_drafts(source_version_id) where source_version_id is not null;
create index if not exists pb28_audit_actor_idx on public.ai_buyer_pb28_audit(actor_id);
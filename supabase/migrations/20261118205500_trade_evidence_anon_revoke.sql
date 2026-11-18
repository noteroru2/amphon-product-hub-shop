-- Defense in depth: RLS is already admin-only, also remove anonymous Data API privileges.
revoke all on public.trade_evidence from anon;
revoke all on public.trade_evidence_images from anon;
revoke all on public.trade_evidence_audit from anon;
revoke all on public.trade_evidence_ai_ready_v from anon;

-- Open AI Buyer in approval-only mode after V2.7 replay passed.
-- No automated LINE offer may be sent while mode != AUTO.

update public.ai_buyer_category_automation_modes
set
  mode='APPROVAL',
  active=true,
  max_negotiation_rounds=4,
  metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
    'phase','V2.7_APPROVAL',
    'priceBook','AMPHON Master Price Book V2.7 Owner Calibrated',
    'replayRunId','27f02ca0-c454-45f5-aee9-a8fe682ec0b4',
    'replayRegressions',0,
    'openedAt','2026-10-01T18:55:00+07:00',
    'outboundPolicy','ADMIN_APPROVAL_REQUIRED'
  ),
  updated_at=now()
where category in (
  'NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER'
);

do $$
declare
  v_bad integer;
begin
  select count(*)::int into v_bad
  from public.ai_buyer_category_automation_modes
  where category in (
    'NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER'
  )
    and (mode<>'APPROVAL' or active<>true);

  if v_bad<>0 then
    raise exception 'AI_BUYER_APPROVAL_MODE_NOT_APPLIED: %',v_bad;
  end if;
end $$;

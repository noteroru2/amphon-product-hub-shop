-- P0 Conservative Spec Pricing alignment.
-- Align NOTEBOOK/DESKTOP spec engine with V2.5 dealer-first margins.

do $$
declare
  v_active uuid;
begin
  select id into v_active
  from public.ai_buyer_price_book_versions
  where status='ACTIVE' and version_name='AMPHON Master Price Book V2.5 Conservative'
  limit 1;

  if v_active is null then
    raise exception 'Expected V2.5 Conservative active price book';
  end if;

  update public.ai_buyer_spec_price_settings
  set target_buy_percent=0.53,
      hard_max_percent=0.58,
      risk_reserve=700,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'calibrationMode','DEALER_CONSERVATIVE_V2_5',
        'calibratedAt','2026-09-22',
        'note','Aligned with conservative Notebook market fallback after owner feedback'
      ),
      updated_at=now()
  where version_id=v_active and category='NOTEBOOK';

  update public.ai_buyer_spec_price_settings
  set target_buy_percent=0.50,
      hard_max_percent=0.56,
      risk_reserve=800,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'calibrationMode','DEALER_CONSERVATIVE_V2_5',
        'calibratedAt','2026-09-22',
        'note','Aligned with conservative Desktop market fallback after owner feedback'
      ),
      updated_at=now()
  where version_id=v_active and category='DESKTOP_PC';
end $$;

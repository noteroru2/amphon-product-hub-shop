-- Allow verified market fallback when notebook/desktop spec pricing cannot map an exact known model.
insert into public.ai_buyer_category_pricing_rules (
  category, market_enabled, buyback_percent, min_buyback_percent, max_buyback_percent,
  opening_discount_percent, hard_max_percent, risk_reserve, rounding_step,
  min_market_comparables, max_market_dispersion, adjustments, active
)
values
  (
    'NOTEBOOK', true, 0.58000, 0.50000, 0.68000, 0.06000, 0.62000,
    400, 100, 3, 0.3000,
    '{"BATTERY_BAD":-800,"NO_CHARGER":-500,"NO_BOX":-200,"BODY_HEAVY":-1000,"SCREEN_DEFECT":-2000,"HINGE_ISSUE":-1500,"MISSING_ACCESSORY":-300,"KEYBOARD_DEFECT":-800,"TOUCHPAD_DEFECT":-500}'::jsonb,
    true
  ),
  (
    'DESKTOP_PC', true, 0.54000, 0.48000, 0.65000, 0.07000, 0.59000,
    600, 100, 3, 0.3200,
    '{"NO_BOX":0,"BODY_HEAVY":-500,"SCREEN_DEFECT":0,"MISSING_ACCESSORY":-300}'::jsonb,
    true
  )
on conflict (category) do update set
  market_enabled=excluded.market_enabled,
  buyback_percent=excluded.buyback_percent,
  min_buyback_percent=excluded.min_buyback_percent,
  max_buyback_percent=excluded.max_buyback_percent,
  opening_discount_percent=excluded.opening_discount_percent,
  hard_max_percent=excluded.hard_max_percent,
  risk_reserve=excluded.risk_reserve,
  rounding_step=excluded.rounding_step,
  min_market_comparables=excluded.min_market_comparables,
  max_market_dispersion=excluded.max_market_dispersion,
  adjustments=excluded.adjustments,
  active=excluded.active,
  updated_at=now();
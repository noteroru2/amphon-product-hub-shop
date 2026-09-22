-- Enable the locked V1 market fallback for model-priced categories.
-- Price Book remains first priority; web comparables are used only when no reliable active row matches.
insert into public.ai_buyer_category_pricing_rules (
  category,
  market_enabled,
  buyback_percent,
  min_buyback_percent,
  max_buyback_percent,
  opening_discount_percent,
  hard_max_percent,
  risk_reserve,
  rounding_step,
  min_market_comparables,
  max_market_dispersion,
  adjustments,
  active
)
values
  (
    'MACBOOK', true, 0.58000, 0.50000, 0.68000, 0.06000, 0.64000,
    600, 100, 3, 0.3000,
    '{"BATTERY_BAD":-1500,"NO_CHARGER":-500,"NO_BOX":-300,"BODY_HEAVY":-1000,"SCREEN_DEFECT":-2500,"HINGE_ISSUE":-1500,"MISSING_ACCESSORY":-300}'::jsonb,
    true
  ),
  (
    'SMARTPHONE', true, 0.60000, 0.50000, 0.70000, 0.06000, 0.67000,
    300, 100, 3, 0.3000,
    '{"BATTERY_BAD":-800,"NO_BOX":-200,"BODY_HEAVY":-700,"SCREEN_DEFECT":-2000,"MISSING_ACCESSORY":-200}'::jsonb,
    true
  ),
  (
    'TABLET', true, 0.58000, 0.50000, 0.68000, 0.06000, 0.65000,
    400, 100, 3, 0.3000,
    '{"BATTERY_BAD":-800,"NO_CHARGER":-300,"NO_BOX":-200,"BODY_HEAVY":-700,"SCREEN_DEFECT":-1800,"MISSING_ACCESSORY":-300}'::jsonb,
    true
  ),
  (
    'CAMERA', true, 0.55000, 0.48000, 0.66000, 0.07000, 0.62000,
    500, 100, 3, 0.3000,
    '{"BATTERY_BAD":-500,"NO_CHARGER":-500,"NO_BOX":-200,"BODY_HEAVY":-700,"SCREEN_DEFECT":-1000,"MISSING_ACCESSORY":-500}'::jsonb,
    true
  )
on conflict (category) do update set
  market_enabled = excluded.market_enabled,
  buyback_percent = excluded.buyback_percent,
  min_buyback_percent = excluded.min_buyback_percent,
  max_buyback_percent = excluded.max_buyback_percent,
  opening_discount_percent = excluded.opening_discount_percent,
  hard_max_percent = excluded.hard_max_percent,
  risk_reserve = excluded.risk_reserve,
  rounding_step = excluded.rounding_step,
  min_market_comparables = excluded.min_market_comparables,
  max_market_dispersion = excluded.max_market_dispersion,
  adjustments = excluded.adjustments,
  active = excluded.active,
  updated_at = now();

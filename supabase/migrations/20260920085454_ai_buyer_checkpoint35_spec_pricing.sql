-- AMPHON AI Buyer V1 — Checkpoint 3.5: Spec-Based Pricing

create table if not exists public.ai_buyer_spec_price_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.ai_buyer_price_book_versions(id) on delete cascade,
  category text not null check (category in ('NOTEBOOK','DESKTOP_PC')),
  component_type text not null check (component_type in (
    'CPU','GPU','RAM','SSD','DISPLAY','BRAND','SERIES','CONDITION','WARRANTY','DEFECT',
    'MOTHERBOARD','STORAGE','PSU','CASE','COOLER','SYSTEM_CLASS'
  )),
  lookup_key text not null,
  normalized_key text not null,
  numeric_value numeric(12,4) not null default 0,
  confidence text not null default 'MEDIUM' check (confidence in ('HIGH','MEDIUM','LOW','NA')),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, category, component_type, normalized_key)
);

create index if not exists ai_buyer_spec_price_lookup_idx
  on public.ai_buyer_spec_price_entries(version_id, category, component_type, normalized_key)
  where active = true;

create index if not exists ai_buyer_spec_price_version_idx
  on public.ai_buyer_spec_price_entries(version_id, category)
  where active = true;

create table if not exists public.ai_buyer_spec_price_settings (
  version_id uuid not null references public.ai_buyer_price_book_versions(id) on delete cascade,
  category text not null check (category in ('NOTEBOOK','DESKTOP_PC')),
  base_value numeric(12,2) not null default 0 check (base_value >= 0),
  target_buy_percent numeric(6,5) not null check (target_buy_percent > 0 and target_buy_percent < 1),
  hard_max_percent numeric(6,5) not null check (hard_max_percent > 0 and hard_max_percent < 1),
  opening_discount_percent numeric(6,5) not null default 0.05
    check (opening_discount_percent >= 0 and opening_discount_percent < 0.5),
  risk_reserve numeric(12,2) not null default 0 check (risk_reserve >= 0),
  rounding_step integer not null default 100 check (rounding_step between 1 and 10000),
  confidence_gate numeric(5,4) not null default 0.9000 check (confidence_gate >= 0 and confidence_gate <= 1),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (version_id, category),
  check (target_buy_percent <= hard_max_percent)
);

create table if not exists public.ai_buyer_price_calibrations (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.ai_buyer_price_book_versions(id) on delete cascade,
  category text not null
    check (category in ('NOTEBOOK','DESKTOP_PC','MACBOOK','SMARTPHONE','TABLET','CAMERA')),
  case_label text not null,
  observed_low numeric(12,2),
  observed_high numeric(12,2),
  observed_mid numeric(12,2),
  engine_estimate numeric(12,2),
  delta_percent numeric(8,5),
  evidence_type text not null default 'MARKET'
    check (evidence_type in ('MARKET','OWNER_MARKET_OBSERVATION','PROXY','ADMIN_OVERRIDE')),
  evidence jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists ai_buyer_calibration_version_idx
  on public.ai_buyer_price_calibrations(version_id, category, created_at desc);

drop trigger if exists ai_buyer_spec_entries_touch on public.ai_buyer_spec_price_entries;
create trigger ai_buyer_spec_entries_touch
before update on public.ai_buyer_spec_price_entries
for each row execute function public.ai_buyer_touch_updated_at();

drop trigger if exists ai_buyer_spec_settings_touch on public.ai_buyer_spec_price_settings;
create trigger ai_buyer_spec_settings_touch
before update on public.ai_buyer_spec_price_settings
for each row execute function public.ai_buyer_touch_updated_at();

alter table public.ai_buyer_spec_price_entries enable row level security;
alter table public.ai_buyer_spec_price_settings enable row level security;
alter table public.ai_buyer_price_calibrations enable row level security;

revoke all on table
  public.ai_buyer_spec_price_entries,
  public.ai_buyer_spec_price_settings,
  public.ai_buyer_price_calibrations
from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_buyer_spec_price_entries,
  public.ai_buyer_spec_price_settings,
  public.ai_buyer_price_calibrations
to service_role;

comment on table public.ai_buyer_spec_price_entries is
  'Versioned spec-based component values and modifiers for AMPHON notebook/desktop pricing. Server-only.';
comment on table public.ai_buyer_spec_price_settings is
  'Versioned formula settings for spec-based pricing. Server-only.';
comment on table public.ai_buyer_price_calibrations is
  'Auditable market/admin calibration observations used to tune AMPHON price-book versions.';

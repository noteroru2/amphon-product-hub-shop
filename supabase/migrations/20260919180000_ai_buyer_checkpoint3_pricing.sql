-- AMPHON AI Buyer V1 — Checkpoint 3: Price Book + Pricing Engine + Price Guard

alter table public.ai_buyer_price_book_entries
  add column if not exists normalized_brand text,
  add column if not exists normalized_model text,
  add column if not exists normalized_model_code text,
  add column if not exists lookup_keys text[] not null default '{}';

create index if not exists ai_buyer_price_entries_lookup_keys_gin
  on public.ai_buyer_price_book_entries using gin(lookup_keys);

create unique index if not exists ai_buyer_one_active_price_book_idx
  on public.ai_buyer_price_book_versions((status))
  where status = 'ACTIVE';

create table if not exists public.ai_buyer_price_book_imports (
  id uuid primary key default gen_random_uuid(),
  version_id uuid references public.ai_buyer_price_book_versions(id) on delete set null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING','SUCCEEDED','FAILED')),
  source_name text,
  source_checksum text,
  entry_count integer not null default 0,
  rule_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ai_buyer_price_imports_version_idx
  on public.ai_buyer_price_book_imports(version_id, created_at desc)
  where version_id is not null;

create table if not exists public.ai_buyer_category_pricing_rules (
  category text primary key
    check (category in ('NOTEBOOK','MACBOOK','DESKTOP_PC','SMARTPHONE','TABLET','CAMERA','OTHER')),
  market_enabled boolean not null default false,
  buyback_percent numeric(6,5) not null default 0.60000
    check (buyback_percent > 0 and buyback_percent < 1),
  min_buyback_percent numeric(6,5) not null default 0.50000
    check (min_buyback_percent > 0 and min_buyback_percent < 1),
  max_buyback_percent numeric(6,5) not null default 0.70000
    check (max_buyback_percent > 0 and max_buyback_percent < 1),
  opening_discount_percent numeric(6,5) not null default 0.05000
    check (opening_discount_percent >= 0 and opening_discount_percent < 0.5),
  hard_max_percent numeric(6,5) not null default 0.68000
    check (hard_max_percent > 0 and hard_max_percent < 1),
  risk_reserve numeric(12,2) not null default 0
    check (risk_reserve >= 0),
  rounding_step integer not null default 100
    check (rounding_step between 1 and 10000),
  min_market_comparables integer not null default 3
    check (min_market_comparables between 3 and 12),
  max_market_dispersion numeric(7,4) not null default 0.3500
    check (max_market_dispersion > 0 and max_market_dispersion <= 1),
  adjustments jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (min_buyback_percent <= buyback_percent),
  check (buyback_percent <= max_buyback_percent),
  check (buyback_percent <= hard_max_percent),
  check (hard_max_percent <= max_buyback_percent)
);

drop trigger if exists ai_buyer_category_rules_touch on public.ai_buyer_category_pricing_rules;
create trigger ai_buyer_category_rules_touch
before update on public.ai_buyer_category_pricing_rules
for each row execute function public.ai_buyer_touch_updated_at();

create table if not exists public.ai_buyer_market_comparables (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.ai_buyer_valuation_cases(id) on delete cascade,
  pricing_decision_id uuid references public.ai_buyer_pricing_decisions(id) on delete set null,
  source_url text not null,
  source_domain text,
  source_title text,
  product_title text,
  price numeric(12,2) not null check (price > 0),
  currency text not null default 'THB',
  listing_condition text not null
    check (listing_condition in ('USED_GOOD','USED_NORMAL','USED_FAIR','NEW','REFURBISHED','DEFECTIVE','UNKNOWN')),
  spec_match numeric(5,4) not null default 0 check (spec_match >= 0 and spec_match <= 1),
  source_verified boolean not null default false,
  included_in_estimate boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  searched_at timestamptz not null default now()
);

create index if not exists ai_buyer_market_case_idx
  on public.ai_buyer_market_comparables(case_id, searched_at desc);

create index if not exists ai_buyer_market_decision_idx
  on public.ai_buyer_market_comparables(pricing_decision_id)
  where pricing_decision_id is not null;

create or replace function public.ai_buyer_activate_price_book(p_version_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as 'declare
  v_exists boolean;
  v_count integer;
begin
  select exists(
    select 1 from public.ai_buyer_price_book_versions where id = p_version_id
  ) into v_exists;

  if not v_exists then
    raise exception ''AI_BUYER_PRICE_BOOK_VERSION_NOT_FOUND'';
  end if;

  select count(*) into v_count
  from public.ai_buyer_price_book_entries
  where version_id = p_version_id and active = true;

  if v_count = 0 then
    raise exception ''AI_BUYER_PRICE_BOOK_EMPTY'';
  end if;

  update public.ai_buyer_price_book_versions
  set status = ''ARCHIVED''
  where status = ''ACTIVE'' and id <> p_version_id;

  update public.ai_buyer_price_book_versions
  set status = ''ACTIVE'', activated_at = now()
  where id = p_version_id;
end;';

create or replace function public.ai_buyer_guard_offer_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as 'declare
  v_hard_max numeric(12,2);
  v_decision_case uuid;
begin
  if new.actor in (''AI'', ''ADMIN'') then
    select hard_max, case_id
      into v_hard_max, v_decision_case
    from public.ai_buyer_pricing_decisions
    where id = new.pricing_decision_id;

    if v_hard_max is null or v_decision_case is distinct from new.case_id then
      raise exception ''AI_BUYER_PRICING_DECISION_INVALID'';
    end if;

    if new.amount > v_hard_max then
      raise exception ''AI_BUYER_HARD_MAX_EXCEEDED'';
    end if;
  end if;

  return new;
end;';

drop trigger if exists ai_buyer_offer_price_guard on public.ai_buyer_offers;
create trigger ai_buyer_offer_price_guard
before insert or update of amount, pricing_decision_id, case_id, actor
on public.ai_buyer_offers
for each row execute function public.ai_buyer_guard_offer_insert();

alter table public.ai_buyer_price_book_imports enable row level security;
alter table public.ai_buyer_category_pricing_rules enable row level security;
alter table public.ai_buyer_market_comparables enable row level security;

revoke all on table
  public.ai_buyer_price_book_imports,
  public.ai_buyer_category_pricing_rules,
  public.ai_buyer_market_comparables
from anon, authenticated;

grant select, insert, update, delete on table
  public.ai_buyer_price_book_imports,
  public.ai_buyer_category_pricing_rules,
  public.ai_buyer_market_comparables
to service_role;

revoke all on function public.ai_buyer_activate_price_book(uuid) from public, anon, authenticated;
revoke all on function public.ai_buyer_guard_offer_insert() from public, anon, authenticated;

grant execute on function public.ai_buyer_activate_price_book(uuid) to service_role;

comment on table public.ai_buyer_category_pricing_rules is
  'Configurable market fallback rules. market_enabled must be explicitly enabled before web-derived pricing can auto-run.';

comment on function public.ai_buyer_guard_offer_insert() is
  'Database-level hard max guard for shop-originated AI/ADMIN offers.';

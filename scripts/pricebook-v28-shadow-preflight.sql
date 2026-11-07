-- PriceBook V2.8 safety preflight, SHADOW only; NOT connected to live AI Buyer.
-- Apply only on the designated Supabase project. Private schema; no anon/authenticated access.
create schema if not exists ai_buyer_qa;
create or replace function ai_buyer_qa.pb28_rtx3050_preflight(
  p_name text,
  p_vram_gb integer default null
)
returns text
language sql immutable security invoker
set search_path = pg_catalog
as $$
with evidence as (
  select upper(coalesce(p_name,'')) as name,
    (regexp_match(upper(coalesce(p_name,'')),
      'RTX[[:space:]]*3050[[:space:]]+([468])[[:space:]]*GB'))[1] as labeled_vram
), state as (
  select name, labeled_vram,
    name ~ 'RTX[[:space:]]*3050[[:space:]]*TI([^[:alnum:]]|$)' as ti,
    name ~ 'RTX[[:space:]]*3050([^[:digit:]]|$)' as gpu
  from evidence
)
select case
  when not gpu then 'NOT_RTX3050'
  when ti then 'RTX3050TI_SEPARATE'
  when p_vram_gb is not null and p_vram_gb not in (4,6,8) then 'REVIEW_INVALID_VRAM'
  when p_vram_gb is not null and labeled_vram is not null
       and p_vram_gb::text<>labeled_vram then 'REVIEW_CONFLICTING_VRAM'
  when p_vram_gb is null and labeled_vram is null then 'REVIEW_VRAM_UNKNOWN'
  when coalesce(p_vram_gb,labeled_vram::integer)=4 then 'RTX3050_4GB_VERIFIED'
  when coalesce(p_vram_gb,labeled_vram::integer)=6 then 'RTX3050_6GB_VERIFIED'
  else 'REVIEW_UNSUPPORTED_VRAM'
end from state;
$$;
revoke all on schema ai_buyer_qa from public,anon,authenticated;
revoke all on function ai_buyer_qa.pb28_rtx3050_preflight(text,integer)
  from public,anon,authenticated;

-- Read-only historical replay (no LINE outbound, no price decisions written).
with h as (
  select distinct on (inventory_code) inventory_code,product_name
  from public.ai_buyer_cost_history
  where source_kind='INVENTORY'
    and category='โน๊ตบุ๊ค'
    and product_name ~* 'RTX[[:space:]]*3050'
  order by inventory_code,occurred_at desc
)
select ai_buyer_qa.pb28_rtx3050_preflight(product_name,null) outcome,
       count(*) cases
from h
group by outcome
order by outcome;

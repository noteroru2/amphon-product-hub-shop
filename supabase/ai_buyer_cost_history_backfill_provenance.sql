begin;
alter table public.ai_buyer_cost_import_batches alter column actor_id drop not null;
alter table public.ai_buyer_cost_import_batches add column if not exists import_origin text not null default 'HUB_OWNER'
check (import_origin in ('HUB_OWNER','ADMIN_ASSISTED'));
commit;
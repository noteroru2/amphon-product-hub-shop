-- Preserve the existing view, column contract, grants and options throughout the migration.
do $migration$
declare
  original_definition text := pg_get_viewdef('public.trade_evidence_ai_ready_v'::regclass, true);
  temporary_definition text := replace(original_definition,'ORDER BY i.sort_order','ORDER BY i.created_at');
begin
  if temporary_definition = original_definition then
    raise exception 'Unexpected image ordering in trade_evidence_ai_ready_v';
  end if;
  execute 'create or replace view public.trade_evidence_ai_ready_v as ' || temporary_definition;
  alter table public.trade_evidence_images alter column sort_order type bigint;
  execute 'create or replace view public.trade_evidence_ai_ready_v as ' || original_definition;
end
$migration$;

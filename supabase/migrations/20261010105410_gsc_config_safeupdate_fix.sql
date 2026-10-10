-- Scope OAuth state invalidation so PostgREST safeupdate accepts configuration saves.
do $$
declare definition text; old_sql text := 'update public.commerce_gsc_oauth_states set expires_at=now();';
new_sql text := 'update public.commerce_gsc_oauth_states set expires_at=now() where expires_at>now();';
begin
  select pg_get_functiondef('public.commerce_gsc_internal(text,jsonb)'::regprocedure) into definition;
  if strpos(definition, old_sql)=0 then raise exception 'Expected GSC configuration statement not found'; end if;
  execute replace(definition,old_sql,new_sql);
end $$;

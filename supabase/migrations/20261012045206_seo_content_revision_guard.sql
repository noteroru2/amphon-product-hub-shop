-- A revised draft invalidates an in-flight publication proof and its worker lease.
do $$ declare definition text; old_statement text:='approved_body=null,approved_at=null,approved_by=null,updated_at=now()'; begin
 select pg_get_functiondef('public.seo_lab_manage(text,jsonb)'::regprocedure) into definition;
 if strpos(definition,old_statement)=0 then raise exception 'Expected draft revision statement missing'; end if;
 execute replace(definition,old_statement,'approved_body=null,approved_at=null,approved_by=null,render_requested_at=null,render_lease_id=null,render_lease_until=null,proof_excerpt=null,requested_commit_url=null,updated_at=now()');
end $$;

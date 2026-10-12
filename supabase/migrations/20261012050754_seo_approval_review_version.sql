-- Approval must freeze the exact text shown to the owner, not a concurrent edit.
do $$ declare definition text; anchor text:='if j.status<>''EVIDENCE_READY'' or length(j.draft_body)<100'; begin
 select pg_get_functiondef('public.seo_lab_manage(text,jsonb)'::regprocedure) into definition;
 if strpos(definition,anchor)=0 then raise exception 'Approval validation anchor missing'; end if;
 execute replace(definition,anchor,'if p_data->>''expected_body'' is distinct from j.draft_body then raise exception ''Draft changed; reload and review the current version''; end if; '||anchor);
end $$;

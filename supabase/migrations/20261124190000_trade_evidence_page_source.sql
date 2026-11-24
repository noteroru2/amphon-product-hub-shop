alter table public.trade_evidence
  add column source_site_id text references public.commerce_seo_sites(id),
  add column source_page_path text,
  add constraint trade_evidence_source_path_check check (
    source_page_path is null or (source_site_id is not null and
      left(source_page_path,1)='/' and left(source_page_path,2)<>'//' and
      source_page_path !~ '[?#[:space:][:cntrl:]]' and length(source_page_path)<=2048)
  );

create index trade_evidence_verified_source_idx
  on public.trade_evidence(source_site_id,source_page_path,kind)
  where transaction_verified;

create function public.guard_verified_trade_source() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.transaction_verified and
    (old.source_site_id,old.source_page_path) is distinct from (new.source_site_id,new.source_page_path) then
    raise exception 'Unverify the transaction before editing its reported source';
  end if;
  return new;
end;
$$;
create trigger trade_evidence_guard_verified_source
before update of source_site_id,source_page_path on public.trade_evidence
for each row execute function public.guard_verified_trade_source();

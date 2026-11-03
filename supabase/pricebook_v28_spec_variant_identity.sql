begin;
drop index if exists public.pb28_entry_identity_unique;
create unique index pb28_entry_identity_unique on public.ai_buyer_pb28_entries
(draft_id,lower(btrim(category)),lower(btrim(brand)),lower(btrim(model)),
 lower(btrim(model_code)),lower(btrim(condition_key)),md5(spec_match::text));
commit;
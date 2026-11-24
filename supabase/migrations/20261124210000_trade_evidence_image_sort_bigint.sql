-- The uploader orders images by Unix milliseconds, including older deployed clients.
alter table public.trade_evidence_images alter column sort_order type bigint;

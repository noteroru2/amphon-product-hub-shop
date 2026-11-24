# AMPHON Evidence Publisher — gated V1 (DRAFT, NOT DEPLOYED)

## What this change implements
- Owner-only Worker API `POST /api/publish` accepts one APPROVED evidence image plus a set of existing enabled network site IDs and exact service-page paths.
- Rechecks current database approvals (record, permission, privacy, individual image) **server-side**, never trusts browser flags.
- Reads from private Supabase Storage server-to-server. Does not expose original paths, source images, signed URLs or service credentials.
- Cloudflare Images Binding decodes/re-encodes to WebP and caps width at 1400, saving an immutable R2 derivative. This strips original file metadata. Visible identifiers still require the existing human privacy review.
- Serves only derivatives via a dedicated public `GET /media/evidence/{evidence_uuid}/{image_uuid}.webp` route. Configure a separately named R2 bucket for this worker.
- Queues each selected destination into `commerce_evidence_publication_requests` with `PENDING_SOURCE_PR`. Queuing **does not** create GitHub PRs, edit a website, merge, or deploy. A later reviewed source-change executor consumes the queue and opens a **Draft PR only**.
- If `transaction_verified=false`, the receipt explicitly says `ASSESSMENT_ONLY`; do not present as completed purchase/sale.
- Owner must approve target-specific source PR, verify rendered content, and separately approve Merge and Cloudflare Deploy.

## Integration setup after PR approval
1. Review `supabase/migrations/20261124_evidence_publisher.sql` and apply it separately in staging. **Never auto-run migration from a PR.**
2. Provision separate R2 public-derivatives bucket (private R2, only public via Worker URL), Cloudflare Images binding, and publish Worker under a permanent HTTPS hostname. Check Images subscription/availability and pricing.
3. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUBLIC_ORIGIN`, and `ALLOWED_ORIGINS` in Worker settings; **do not commit keys**. Restrict `ALLOWED_ORIGINS` to Hub origin. Put `VITE_EVIDENCE_PUBLISHER_API` in Hub build configuration.
4. Verify owner permissions, non-owner forbidden, bad ID, archived evidence, image not approved, disabled site, unsafe path, receipt integrity, R2 object public read, PII redaction and EXIF removal.
5. Run `npm run typecheck`, `npm run build`, and the Worker tests before deployment approval.
6. Publish a site-specific Draft PR using existing SEO source-change workflow; check old URL/canonical/H1/schema/links remain intact; merge/deploy only by distinct owner approval. On live check fill SHA, timestamp and exact URL into the receipt before Final GSC 7/14/28-day measurements.

## Important boundaries
- `source_site_id/source_page_path` on trade_evidence represent customer acquisition attribution and **must not** be reused as destinations. Destinations are independent explicit selections.
- Public derivatives cannot be assumed safe from privacy review merely because the pixels have been transcoded; the approval asserts a human inspected visible content.
- This V1 does **not** automatically generate a site PR or publish a page. That needs a separate locked-down GitHub adapter mapping each site and its content structure. Until integrated, targets remain queued.
- R2 keys are deterministic. To correct/redact a previously public image, revoke/unpublish the old derivative, purge CDN caches, and use a new versioned asset; never simply overwrite under immutable cache.

# Batch 3.3 — Production Workflow & Guardrails Report

Status: `IMPLEMENTED_WITH_ENVIRONMENT_WARNING`

## Implemented

- Real-time Serial / IMEI duplicate pre-check in the mobile smart form.
- Server-side duplicate check before product save.
- PostgreSQL trigger-level duplicate protection for active inventory.
- Identifier normalization ignores case, spaces and punctuation.
- Historical Sold/Returned/Cancelled records do not prevent later buy-back as a new stock record.
- Save lock prevents repeated taps from starting multiple save flows.
- Frontend/backend status-transition allowlist.
- PostgreSQL status-transition trigger as a second line of defense.
- Confirmation before Sold / Returned / Cancelled state changes.
- Owner/Admin-only reopen from Returned/Cancelled to Draft.
- Existing product status is preserved while newly added images upload.
- Explicit pending-image warning and retry wording.
- Successful partial uploads remain attached to the draft and are not uploaded again on retry.
- Expanded activity logging: create, update, identifier change, status change, image upload/delete, incomplete upload and save.
- Owner/Admin product activity timeline.

## Required deployment change

Run once after Batch 3.2:

```text
supabase/batch3_3.sql
```

No Cloudflare R2 Worker redeploy is required.

## Verification

- TypeScript/TSX transpile syntax audit: `PASS`.
- Strict TypeScript static audit with temporary dependency shims: `PASS`.
- `supabase/schema.sql` contains the Batch 3.3 migration for fresh installs.
- `supabase/batch3_3.sql` is safe to re-run.
- npm dependency-resolved build could not be completed in the execution environment because `npm install` timed out while reaching the registry.

Final machine gate:

```bash
npm install
npm run typecheck
npm run build
```

Do not call production deployment complete until those commands pass on the deployment machine.

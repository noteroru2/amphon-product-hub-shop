# AMPHON Evidence Publisher: private-media cancellation and retention gate

**State:** code review / unmerged Draft PR #181; **NO PRODUCTION CHANGES**.

## Why the cancellation design changed

Previously, `POST /api/cancel` checked whether other queue rows referenced an R2 key, then immediately deleted the key using the Worker binding. This had a time-of-check/time-of-use race: a new queue could appear after that check but before the delete, leading to unwanted loss of a file used by a new request.

The metadata-only Cloudflare Worker no longer has ANY R2 bucket binding or object-delete capability. Cancellation performs a conditional queue status update and returns:
`{"status":"CANCELLED","media_public":false,"private_media_cleanup":"DEFERRED_LOCKED_REVIEW"}`.

## Future owner-approved retention workflow (NOT BUILT OR ENABLED)

A separate, owner-reviewed janitor must:
1. Make deletion explicitly opt-in and use a lock/transaction to exclude concurrent same-image enqueue/stage operations.
2. Verify that **no active queue** refers to the exact private key and the retention period has expired.
3. Never operate on the public website, raw Supabase Storage original or customer assets.
4. Log object-key hash, operator approval and queue IDs without storing raw image bytes or credentials.
5. Tolerate retries, races, transient R2 errors and partial cancellations without deleting a shared image.
6. Require security tests on concurrent queue insertion and cancellation before ever receiving R2 Delete access.

Until then, leave a cancelled request's object private; there is no public R2 route or domain. R2 retention/storage consumption must be reviewed before production activation.

## Supabase database release prerequisites

The proposed `supabase/migrations/20261124_evidence_publisher.sql` creates two private, RLS-enabled tables only after separate explicit owner approval. Preflight requires read-only verification of actual Production schemas/foreign keys, audit of grants, an owner-approved rollback plan and a green disposable PostgreSQL 17 / Supabase Local test. No new `sb_secret_...` key or write to live Supabase is authorized by this file.

## Release invariants

- `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED`.
- No website or Hub Merge/Deploy, no live Supabase DDL/DML, no real customer photos.
- No actual GitHub App installation on production website repositories without separate owner approval.
- No paid Supabase branch or services.

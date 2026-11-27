# AMPHON Evidence Publisher: private-media cancellation and retention gate

Latest release gate updates: [release review](EVIDENCE_PUBLISHER_RELEASE_REVIEW.md).
Guarded test fixture sources now live outside migration discovery. Actual
historical Hub upload/list/preview/download/delete and revoke/reapprove passed;
metadata list permission is explicitly staff-scoped. Five-second handler input
cancellation does not prove the pre-handler ingress limit: the Local Edge ingress
probe timed out at eight seconds, so that exposure gate remains open.

## Current implemented protocol — 2026-11-27

This section is authoritative for the local QA branch; earlier sections below
are historical. Proposed migration `20261126160233_evidence_recovery_local_qa.sql`
was exercised only on disposable Local Supabase. It has not been applied hosted.

### Durable writes and recovery

Private `evidence_internal` tables persist media reservations, operations,
approvals, audit events and a disabled cleanup policy. Browser roles cannot run
the service journal; even service-role direct table access is revoked. Controlled
RPCs enforce canonical operation identities, immutable checkpoints and fenced
executor tokens. Read-only lookup never returns those tokens. Missing tokens
and superseded executors fail closed. States are RUNNING, UNCERTAIN, DONE and
BLOCKED. Reservations have no automatic timeout or takeover.

Stage intent precedes R2 PUT. HEAD verifies exact key, SHA-256 metadata, length
and ETag before reuse and after a conditional `If-None-Match: *` PUT. A lost PUT
response or database receipt retains the reservation. A fresh live Owner must
attest the previous executor is quiescent and approve takeover of the exact
operation. Positive HEAD proof can reconcile without uploading. A negative HEAD
after uncertainty cannot prove an old write will never finish: it never permits
another PUT or clears the reservation. Quarantine remains until separately
reviewed evidence resolves it. Reconciliation is read-only at the providers.

Draft operations persist immutable repository/base/content/branch identity and
tree, commit, branch and PR checkpoints. Deterministic commit dates and exact
branch/parent/file/content/draft/head/base validation allow adoption of an existing
Draft after a crash. Conflicting, closed or unproved remote results remain held.
Queue Draft status and operation completion commit atomically. Cancellation or
consent revocation never becomes a successful publication receipt. Physical
staging may be reconciled separately with `authorization_valid:false` and an audit
event; the caller rejects this as authorization success. Unused branches are
recorded for review, never automatically deleted.

### Locked deletion, disabled by default

`scripts/evidence-cleanup.mjs` is a programmatic mechanism with no CLI invocation,
cron or workflow. It requires explicit caller enablement, enabled database policy,
dedicated cleanup transport credentials and a fresh exact-key/ETag Owner approval.
Default database retention is seven days, constrained to at least one day.
Approval requires a live active Owner session, expires after 15 minutes and can
be revoked using `evidence_owner_revoke_approval`. Signed-out, inactive or revoked
approvers cannot spend an outstanding approval.

The database locks the same media record used by queue/stage mutations, rejects
any active reference, rechecks retention and approval, and permanently tombstones
the key before remote deletion. Concurrent new/reused requests cannot attach a
retired key. Independent journal metadata survives source/queue cascade removal.
Only exact recorded objects are eligible; unknown legacy objects are held for
inventory. DELETE is followed by HEAD absence proof. Lost deletion responses
remain uncertain; approved retries verify absence without repeating deletion.
Completion rechecks policy, references, approval and retention. Audit records
remain even after cancellation/deletion. Metadata retention needs an owner policy.

The Worker has no R2 binding or delete method. Ordinary image transport exposes
HEAD/PUT only. Separate cleanup transport accepts only its own credential names,
requires `EVIDENCE_CLEANUP_ENABLED=YES_OWNER_ENABLED`, validates the fixed private
bucket/key namespace and exposes HEAD/DELETE only. Use a dedicated bucket-scoped
credential with the minimum provider-supported object permissions; standard
Object Read & Write tokens may authorize more verbs than this transport uses.
Do not claim provider-enforced per-verb least privilege without verifying it.
No credentials were provisioned. DELETE safety relies on all writers using this
journal, retiring old executors and preventing out-of-band writes to retired
keys; it does not claim an R2 conditional DELETE guarantee.

### Private image access and revocation limits

The browser now fetches a bounded authenticated POST through
`evidence-private-media`, rather than creating reusable signed URLs. The function
uses the user's token and anon key, verifies live Owner/Admin authorization,
ownership, consent and purpose before and after authenticated Storage download,
and fails closed if authorization changes. Export requires Owner and current
approval/privacy checks. SQL restrictive Storage policy rejects new signed URLs,
anonymous reads and consent-withdrawn direct authenticated reads; separately
authorized erasure remains possible. No service key or public media GET is added.

Responses and browser fetches use no-store; image bytes and request duration are
bounded. Object URLs expire after 60 seconds, refresh every 45 seconds while
visible, and are revoked on hidden/navigation/session changes. Generation fencing
discards delayed responses from an old session. Existing PWA cleanup remains.
Previously issued signed URLs require an owner migration decision; already
downloaded, rendered, independently copied or captured images cannot reliably be
revoked. No code can guarantee erasure from those destinations.

### Local evidence and remaining activation conditions

25 real Local SQL/Auth/Storage recovery scenarios, including actual local Edge
gateway access, passed on 2026-11-27. R2/GitHub were synthetic in-memory adapters,
not provider contract tests. See final QA section 10 for all results and gates.
Owner approval is still required for hosted migration/policy/helper compatibility,
coordinated backend/client deployment, isolated provider validation, actual policy
and credential provisioning, old-client/signed-URL handling and any irreversible
deletion. None was performed or requested as part of this local review.

**State:** code review / unmerged Draft PR #181; **NO PRODUCTION CHANGES**.

**Current status (2026-11-27):** the disabled local implementation described in
the final section below supersedes the historical "NOT BUILT" design and
15-minute signed-URL observations. Nothing is enabled or applied to Production.

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

## Safe QA continuation — 2026-11-26

The Node image step now compares the complete approved snapshot before upload
and rechecks it after upload. Cancellation, deleted source rows, lost Owner
authorization, consent/image revocation or an unavailable database after the
write fail with `POST_UPLOAD_RECONCILE_REQUIRED`. An ambiguous PUT response fails
with `UPLOAD_RESULT_UNCERTAIN_RECONCILE_REQUIRED`. Neither is a rollback receipt:
an object may already exist. No automatic retry or shared-key deletion occurs
inside the invocation. Manual reruns remain unsafe until the result is reconciled.

Draft PR execution similarly rechecks after PR creation and sanitizes ambiguous
write/receipt failures. A surviving branch/PR requires owner reconciliation;
deterministic branch names block duplicate PR attempts. No automatic branch
deletion or PR closure was added.

`scripts/evidence-retention-review.mjs` is a pure, read-only classifier for a
supplied inventory. Tests use synthetic inventories only. It reports a hashed
object key and always returns `deletion_authorized:false`, including for expired
orphans. Active references (including RELEASED), incomplete inventory, unknown
states or missing cancellation timestamps require a hold. Retention age starts
at the latest object write or terminal event, never the queue creation time.
The current queue schema has **no cancellation timestamp or durable media-write
journal**, and cascading source deletion removes queue references. A database
scan alone cannot establish the absence or safe expiry of private objects.

Before real media use, the reviewed design must include:

- A durable operation intent recorded **before** each external write, independent
  of source/queue cascades, with operation ID, consent version, object digest/ETag,
  terminal timestamps and uncertain/completed/reconciled states.
- Same-image serialization or a fencing protocol shared by enqueue, stage and
  cleanup; an expired lease must not permit deletion while an old write is still
  in flight. A point-in-time reference scan is not a lock.
- Owner-approved inventory of the exact private bucket and journal reconciliation
  for process crashes, lost responses, retries, overwritten keys and orphan PRs.
- A retention period/erasure policy and operational owner. No blanket lifecycle
  expiry may silently delete objects still used by another active site.
- Synthetic crash/fencing/concurrency tests before granting any delete capability.

No such ledger, lock or deletion transport was deployed or claimed complete.

## Browser cache and source signed URLs

The historical Hub PWA cached every image request in `product-images` for seven
days, including signed private evidence URLs. Local source now routes private,
signed and authorized image requests through NetworkOnly/no-store before the
public product-image cache. An activation script selectively removes matching
historical entries. Synthetic cache tests and the actual built service-worker
smoke check cover this; no deployed browser was accessed or changed.

These protections take effect only after a separately approved Hub release and
new service-worker activation. They cannot erase an existing page's pixels,
downloads, screenshots or every browser HTTP-cache copy. The existing source
viewer creates signed URLs for 15 minutes. Supabase documents that signed URLs
are checked at creation and individual URLs cannot be revoked directly:
[Storage access control](https://supabase.com/docs/guides/storage/security/access-control),
[signed URL revocation](https://supabase.com/docs/guides/storage/serving/downloads#revoke-signed-urls).
Queue cancellation is not source-object invalidation. The owner must define the
accepted revocation window or approve a consent-aware authenticated serving
design; never delete or rotate original customer media automatically as a shortcut.

## Supabase database release prerequisites

The proposed `supabase/migrations/20261124_evidence_publisher.sql` creates two private, RLS-enabled tables only after separate explicit owner approval. Preflight requires read-only verification of actual Production schemas/foreign keys, audit of grants, an owner-approved rollback plan and a green disposable PostgreSQL 17 / Supabase Local test. No new `sb_secret_...` key or write to live Supabase is authorized by this file.

## Release invariants

- `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED`.
- No website or Hub Merge/Deploy, no live Supabase DDL/DML, no real customer photos.
- No actual GitHub App installation on production website repositories without separate owner approval.
- No paid Supabase branch or services.

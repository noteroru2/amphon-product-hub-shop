# HUB-6 — SOLD ITEM CLEANUP & CHANNEL TASK AUTOMATION REPORT

## 1. Verdict

**PASS_WITH_REAL_WORLD_ACCEPTANCE_PENDING**

Implementation, forward migration, production deployment, automated QA, RLS checks, and read-only production reconciliation passed. Production currently has no SOLD product and no actionable active external publication, so no truthful real-world cleanup case exists yet.

## 2. Problem solved

An authoritative transition to SOLD now creates internal staff work for every actionable active external publication. The system does not log in to, scrape, click, edit, or remove content on any social platform.

## 3. Previous workflow

HUB-5 showed SOLD warnings but staff had to notice and manage them without a persistent work item, assignment, lifecycle, or completion transaction.

## 4. New workflow

Product becomes SOLD → Hub detects active actionable publications → creates internal tasks → staff claims/starts the exact task → opens the saved external URL if present → performs the external action manually → attests completion in Hub → publication and task close in one database transaction.

## 5. Source-of-truth architecture

- Product/inventory state: existing `products.status` and existing order/inventory flow.
- External publication state: HUB-5 `product_publications` plus append-only `sales_channel_publication_events`.
- Cleanup work: HUB-6 `sales_channel_tasks`.
- HUB-6 never derives or mutates product/payment/order truth.

## 6. Database migration

Applied additive migration `20260913110000_hub6_sold_cleanup_tasks.sql`. HUB-5 migrations `20260913090000` and `20260913093000` were not edited.

## 7. Task schema

Tasks reference the exact product and publication and record channel, task type, status, priority, assignment, source event, timestamps, actor snapshots, completion note, cancellation reason, and idempotency action ID.

## 8. Task lifecycle

`OPEN → IN_PROGRESS → COMPLETED`, with `CANCELLED` as a retained terminal state. Tasks are never hard-deleted by HUB-6.

## 9. Task types

The extensible MVP allowlist is `REMOVE_LISTING`, `UPDATE_LISTING`, and `VERIFY_REMOVAL`.

## 10. Channel cleanup configuration

`sales_channel_cleanup_rules` centralizes DB behavior and the frontend channel definitions expose matching cleanup semantics:

- AMPHON SHOP: disabled for manual cleanup.
- Facebook Marketplace: `REMOVE_LISTING`, high priority.
- Facebook Page: `UPDATE_LISTING`, high priority.
- LINE: disabled by default.
- WINNER IT: `UPDATE_LISTING`, high priority.

## 11. SOLD detection strategy

A narrow `AFTER UPDATE OF status` trigger reacts only to a real transition into `sold`. It calls an idempotent internal function. A separate dry-run reconciliation tool reports missed work and requires an explicit `--apply` flag for mutation.

## 12. Why the strategy cannot break order/payment completion

The SOLD trigger performs no network calls and wraps all task-sync work in an exception boundary. A task-generation error raises only a database warning; it does not abort the product status transaction or a successful paid-order inventory update.

## 13. Idempotency design

Generation uses `INSERT ... ON CONFLICT DO NOTHING`. Completion requires a UUID action ID, locks the task/publication rows, returns the current completed state on retry, and reuses HUB-5 `last_action_id` for publication history.

## 14. Duplicate protection

A partial unique index permits only one `OPEN`/`IN_PROGRESS` task for the same publication and task type. Protection is database-level and safe under concurrent reconciliation.

## 15. Marketplace behavior

SOLD + active Marketplace publication creates one high-priority `REMOVE_LISTING` task pointing to that exact publication. Completion text is explicitly staff attestation, not Facebook verification.

## 16. Facebook Page behavior

The default configured task is `UPDATE_LISTING` with instruction to mark the post sold or close it according to shop policy. Completing the task closes its active Hub publication state.

## 17. LINE behavior

LINE remains HUB-5 share history and creates no SOLD cleanup task by default.

## 18. SHOP behavior

AMPHON SHOP remains derived from inventory/publication commerce truth and creates no redundant manual cleanup task. No SHOP component was deployed.

## 19. Assignment and employee attribution

Staff can claim or start unassigned work. Owner/admin can take over active work. Claim, completion, cancellation, and creation retain safe display names; auth UUIDs are not shown in normal UI.

## 20. Task completion transaction

`complete_sales_channel_task` locks both rows and atomically changes publication `published → ended`, records the HUB-5 publication event, and changes task `OPEN/IN_PROGRESS → COMPLETED` with actor and timestamp.

## 21. Sale reversal behavior

When a product leaves SOLD, open/in-progress tasks are cancelled with `PRODUCT_NO_LONGER_SOLD`. Publications are never reactivated automatically.

## 22. RESERVED behavior

RESERVED is not SOLD and does not generate cleanup tasks. Existing HUB-5 reserved warnings remain.

## 23. Return/relist behavior

A return does not recreate or reactivate any publication. Staff must intentionally relist through HUB-4/HUB-5.

## 24. Multiple publication behavior

The task key is the exact publication ID, so distinct publication records generate distinct tasks. The current HUB-5 model presently enforces one current record per product/channel; HUB-6 does not collapse records if that model is extended later.

## 25. Product detail UI

A SOLD product with active cleanup tasks shows a prominent count and channel list in its sales-channel section.

## 26. Task queue UI

“งานช่องทางขาย” now includes a mobile-first operational queue with an urgent section, all-work section, status/channel/employee/priority/product filters, saved URL, assignment, start, completion, cancellation, and retained audit details.

## 27. Dashboard integration

The Product Hub home dashboard shows an actionable “งานปิดประกาศ” card with active task count and opens the task queue.

## 28. Mobile/PWA UX

Cards and controls collapse to two-column/single-row mobile layouts. Completion requires online server confirmation; no destructive offline operation is silently queued.

## 29. RLS and security

Anonymous access to both HUB-6 tables returns HTTP 401. Active authenticated staff can read tasks/rules. Writes are revoked from direct authenticated table access and are allowed only through guarded RPCs. Cancellation requires owner/admin. No Facebook credential field exists.

## 30. Reconciliation dry-run result

- SOLD products inspected: **0**
- Actionable active external publications: **0**
- Existing active cleanup tasks: **0**
- Missing cleanup tasks: **0**
- Duplicates/conflicts: **0**

## 31. Production data mutations

Production mutation was limited to the authorized forward schema migration and five channel rule/config rows. No product, publication, task, order, reservation, or payment row was changed for QA.

## 32. No fake cleanup task

Confirmed. The production dry run found zero tasks and zero candidates; no fake or historical task was inserted.

## 33. Files changed

- `supabase/migrations/20260913110000_hub6_sold_cleanup_tasks.sql`
- `src/lib/cleanupTasks.ts`
- `src/lib/publications.ts`
- `src/types/product.ts`
- `src/components/CleanupTaskQueue.tsx`
- `src/components/PublishCenter.tsx`
- `src/components/SalesChannelTracker.tsx`
- `src/styles/cleanupTasks.css`
- `src/App.tsx`
- `scripts/reconcile-hub6-cleanup-tasks.mjs`
- `scripts/verify-hub6.mjs`
- `package.json`
- `shop/scripts/verify-shop4.mjs` (quote-format-tolerant verifier only; no SHOP runtime change)

## 34. Migration applied

PASS. Local and remote migration history are synchronized through `20260913110000`.

## 35. Build and typecheck

PASS. TypeScript, Vite production build, PWA generation, and HUB-6 verifier pass. Vite retains the existing advisory that the main JavaScript chunk exceeds 500 kB.

## 36–40. Hub regressions

- HUB-1: PASS, including live domain/API/SHOP state check.
- HUB-2: PASS.
- HUB-3: PASS.
- HUB-4: PASS.
- HUB-5: PASS, including live anonymous data boundary checks.

## 41. SHOP regression

PASS. SHOP-6.2 verifier and SHOP-1..6 production closeout verifier pass. SHOP was not built, modified, or deployed except for making one static verifier tolerant of formatter quote style.

## 42. `purchase_enabled` before/after

Before: **TRUE**. After: **TRUE**.

## 43. PromptPay before/after

Before: **DISABLED**. After: **DISABLED**.

## 44. No order or Stripe transaction

No order, reservation, Stripe Checkout Session, card charge, refund, or payment event was created.

## 45. No social-platform automation

No Facebook/LINE login, cookie, token, API, scraping, auto-click, post edit, or listing deletion was implemented or executed.

## 46. Secret scan

PASS. HUB-6 changed files contain no Stripe secret, Supabase server secret, private key, or Facebook credential.

## 47. Production deployment version

Product Hub Worker `amphon-product-hub`: **`0feadc75-c7d5-48d0-ae30-48f718e08646`**. Live Hub and deployed HUB-6 bundle return HTTP 200. SHOP and API Worker were not deployed.

## 48. Owner-device verification status

**REQUIRED.** Refresh/reopen the Hub/PWA, sign in, open “งานช่องทางขาย,” inspect the task queue/filter layout, confirm the dashboard count card, and verify a normal AVAILABLE product has no false cleanup warning. There is no truthful SOLD + active listing case to test today.

## 49. Remaining warnings

- Real-world acceptance remains pending until the first genuine SOLD product still has an actionable active external publication.
- Existing Vite main-chunk size advisory remains.
- Native mobile/PWA layout and interaction should be confirmed on the owner device.

## Final status

**HUB-6 — SOLD ITEM CLEANUP & CHANNEL TASK AUTOMATION: PASS_WITH_REAL_WORLD_ACCEPTANCE_PENDING**

# AMPHON Evidence Publisher — Free-plan production database migration runbook

**Status 2026-11-26:** PREPARATION ONLY; NO approval to execute live DDL/DML or to touch customer media. PR #181 remains Draft; `EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED=DISABLED`. This document is not authorization to deploy or create a privileged credential.

## Grounded production inventory (read-only, 2026-11-26)

- Supabase project `mfpdtlxwdbxitgfzdape` belongs to organization `amphon-product-hub`; **Free plan**, PostgreSQL **17.6**, ACTIVE_HEALTHY.
- The proposed publisher tables **do not exist**: `public.commerce_evidence_publication_requests` and `public.commerce_evidence_page_source_mappings`.
- Existing referenced tables `public.trade_evidence`, `public.trade_evidence_images`, `public.commerce_seo_sites`, `public.commerce_seo_portfolio_projects` and `auth.users` have compatible `uuid`/`text` key types. `service_role` and `gen_random_uuid()` exist.
- Existing referenced public tables have RLS enabled. There are 14 registered sites, with 12 verified site-repository mappings; this does **not** review/enable any publisher page-source mapping.
- Live storage bucket `trade-evidence-private` is non-public. The migration does not change it.

## BLOCKER: Free-plan backup and recovery

Official Supabase backup documentation (https://supabase.com/docs/guides/platform/backups) says **daily managed backups are provided for Pro, Team and Enterprise**, not the Free plan. PITR is a paid add-on, not available on this Free subscription. **No verified, restorable backup snapshot exists in our audit evidence.** Before any production migration, the owner must create, protect and rehearse an independent **local backup**. Do NOT upgrade a plan or buy a backup service without explicit consent.

Supabase database backup covers **database metadata but not Storage object bytes**. `supabase db dump` has managed-schema exclusions; explicitly inspect whether Auth and Storage metadata needed for a full recovery are included. Never claim the resulting dump can restore all Auth users or photographs until a restore proves it. This evidence migration only creates two private tables, but AMPHON must not lose unrelated business data during disaster recovery.

### Gate 1 — Prepare a trusted owner workstation (no secrets in chat)

1. Use a **personal encrypted laptop/desktop** with available disk space; not a phone, public computer, CI artifact, repository, or GitHub Action. Install current Supabase CLI and Docker Desktop. Verify the exact commands with `supabase --version`, `supabase db dump --help`, `supabase link --help`.
2. Create a local directory **outside any Git repository** (for example `~/amphon-db-backups/2026-11-26`). Secure it with OS encryption, file permissions and no cloud sync. Do not publish or share a screenshot showing connection strings/passwords.
3. Run `supabase init` in this new local throwaway project (not in Hub's repository), then authenticate interactively using `supabase login` and run `supabase link --project-ref mfpdtlxwdbxitgfzdape` there. Never run a CLI command against the live Hub repository by accident. Inspect `supabase link --help` before executing. Enter the database password only into the trusted CLI prompt, not GitHub, chat, shell history, issue bodies or logs.
4. If the CLI requests unsafe operations or offers a paid feature, STOP. Link and dump must be read-only against the database; never run `db push`, `db reset`, `migration up`, `db diff --linked` or `db restore` on the live project.

### Gate 2 — Export roles, schema and data locally (not run in CI)

Inside the owner-only, correctly linked local Supabase folder, after verifying CLI help, dump the three separate files to a protected directory:

```bash
umask 077
mkdir -p ./private-backup
supabase db dump --linked --role-only -f ./private-backup/roles.sql
supabase db dump --linked -f ./private-backup/schema.sql
supabase db dump --linked --data-only --use-copy -f ./private-backup/data.sql
```

Check each exit code; immediately stop if any command fails. Supabase documents this roles/schema/data split at https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore . Never print or paste the contents of `data.sql` into any tool or conversation.

Create local SHA-256 checksums of the three files using a trusted OS hash command; record sizes, date, Postgres version and SHA-256s in a **private** log, not the backup contents. Verify files are non-empty and encrypted or stored on an encrypted device. Treat all dumps as highly sensitive (customer, user and business data).

### Gate 3 — Demonstrate restore *without contacting Production*

Use a separate disposable local Postgres/Supabase instance (Postgres 17 matching Production) and Supabase's official restore workflow. Restore `roles.sql`, `schema.sql`, `data.sql` into **that disposable LOCAL instance only**, resolving extension/version conflicts there. **Never point restore commands at the Production connection string.**

Check schema tables, row counts for approved non-sensitive tables, relevant functions/extensions, Auth behavior and RLS. Verify whether `auth.users` and Storage metadata are actually present; separately inventory/backup raw Storage objects if a complete disaster recovery is required. Failure in any check = **NO-GO**.

Record: dump complete timestamp, local SHA-256s, restore rehearsal date, pass/fail summary, owners and approved RPO/RTO. Do not place raw backup files or PII into GitHub Actions, PR comments, Supabase notebooks or Cloudflare R2 by default.

### Gate 4 — Independent owner approval required *after* verified restore

Explicit scope required: “Approve **only** application of `20261124_evidence_publisher.sql` on the Supabase project `mfpdtlxwdbxitgfzdape`; keep Publisher DISABLED, no deploy, no real photos, no page mappings enabled.” A prior general “do it” does NOT authorize running this migration without backup verification.

Before migration, reconfirm that:
- Both new tables are absent;
- Foreign-key target column types still match (`uuid` evidence/image/users and `text` site ID);
- `gen_random_uuid()`, `service_role` exist, Postgres 17 and RLS unchanged;
- source evidence/Storage retain all prior policies;
- branch remains unmerged, no new payments, no production deployment.

Use a transaction/safe stop-on-error policy appropriate to approved tooling. Any exception = STOP; do not attempt blind rollback or edit old migrations.

### Gate 5 — Post-migration verification (future only; NOT AUTHORIZED NOW)

After separately approved DDL, verify **exactly two** tables exist, both RLS-enabled; no anon/authenticated SELECT or INSERT grants on either; `service_role` can INSERT/SELECT queue and SELECT reviewed mappings; there are zero queue rows and zero enabled mappings; Hub and Worker Publisher remain DISABLED; legacy evidence tables unchanged. Record a migration receipt and follow-up QA window.

### Gate 6 — Rollback / forward-fix (future only)

No whole-project PITR is available. If the DDL transaction fails, use transactional rollback. If it commits, **do not run `DROP TABLE CASCADE`**, especially once records have been written. If both new tables remain empty, an owner-authorized targeted removal may be evaluated after inspecting dependencies. Otherwise, stop Publisher, preserve audit history, take another protected dump, diagnose and prepare a reviewed forward-fix migration. Never reset Production or restore old data over newer business transactions without a recovery plan and owner approval.

## Important scope of our synthetic CI restore rehearsal

The GitHub QA job uses a **synthetic PostgreSQL 17 database with fake UUIDs and zero customer records**. It creates an encrypted/no-sensitive-data-free `pg_dump --format=custom` in runner-local temporary storage, applies the proposed migration in one disposable database, then restores the dump into a **second disposable database** and checks the original tables/rows plus absence of proposed tables. The dump is not uploaded as an artifact and must not be confused with an actual Production backup or a tested recovery of customer data, Auth, or Storage.

## Release invariants

- This runbook contains **no privileged credentials** and no real customer data.
- GitHub App not installed on real target website repositories.
- No live Supabase change, no live Backup export performed by ChatGPT, no photo processing, no merge, no deploy, and no paid branch.
- The owner must report **backup restore rehearsal passed** before asking for migration approval.

## Privacy erasure foreign-key invariant (Draft PR safety fix)

The proposed queue's `evidence_id` and `image_id` foreign keys now use `ON DELETE CASCADE` **inside the unmerged migration**. `ON DELETE RESTRICT` would otherwise prevent deleting a customer's original evidence or image even after cancellation. Deleting original evidence or an image removes its queue metadata and prevents future queue execution. The synthetic PostgreSQL test explicitly deletes an image and checks that its queue row disappears. **This does not delete any already-staged private R2 copy**, so a future separately reviewed consent-revocation/locked media-retention workflow remains a hard release gate.

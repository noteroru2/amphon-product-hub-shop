# Owner-only offline recovery rehearsal

Prepared 2026-11-26. This procedure is not authorization to access Production,
export another backup, enable Publisher, stage to R2, or publish a photograph.
The agent must never open the owner's real backup. All automated development
tests use generated images and fake records. Keep the backup outside this repo.

## Isolation is a prerequisite, not a URL setting

Use a dedicated disposable **Linux VM**, with encrypted disks, no shared folders,
clipboard sync, browser accounts, cloud sync, SSH forwarding or mounted host
Docker socket. Windows Docker Desktop is suitable for synthetic QA, but is not
accepted by the real-backup isolation gate. Do not use the existing development
Supabase project for this rehearsal.

While the backup is still inaccessible, preinstall Node 22, the locked npm
dependencies, Docker, iproute2, and a reviewed Supabase CLI (synthetic QA used
3.4.0). Cache the Supabase Local container images. Copy only the reviewed code
and a fresh local fixture configuration into the VM. Set its project ID to
`amphon-evidence-owner-offline` and its API/DB ports to 55321/55322. Never copy
`supabase/.temp`, linked project metadata, production `.env` files or tokens.

1. Power off the VM and **remove all virtual network adapters** in the hypervisor.
   Disable any other virtual transport to the host. Boot with the backup still
   unmounted. Verify there is no physical or virtual uplink, default route, VPN,
   proxy or DNS path. If this cannot be established, **STOP before opening backup**.
2. Create the dedicated internal Docker bridge:

   ```bash
   docker network create --internal amphon-evidence-owner-offline
   ```

3. From the dedicated local project, inspect the installed `supabase start --help`
   and use its local-only network option:

   ```bash
   supabase start --network-id amphon-evidence-owner-offline \
     -x realtime,studio,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor
   ```

   All images must already be cached. A missing image is a hard stop; never
   reconnect the VM with private data attached. Disable outbound Auth mail,
   webhooks, hooks, Edge Functions and replication. Start with synthetic data.
   The gate also requires all published container ports to bind to `127.0.0.1`,
   no bind mounts, no privileged containers and exactly one internal network per
   container. If the installed CLI publishes wildcard ports or attaches an extra
   network, **STOP**. Have a local Docker operator prepare a reviewed equivalent
   stack with loopback bindings while it contains synthetic data only; do not
   relax the gate or assume that CLI defaults establish isolation.
4. Run the read-only gate inside the VM:

   ```bash
   node scripts/evidence-offline-isolation.mjs http://127.0.0.1:55321
   ```

   Require exit code 0 and `isolated:true`. Missing tools, inaccessible Docker,
   unsupported host, an external/default route, an UP uplink, wrong project,
   remote URL (including Production), extra network, host mount, wildcard bind or
   privileged container fails closed. The script does not contact any URL, accept
   backup filenames, open images, or execute a restore. Unit tests of synthetic
   inspection results do not prove a real VM is isolated.

## Owner restore and private image check

Only after the hypervisor isolation and executable gate succeed may the owner
attach the encrypted backup as a read-only virtual disk. Keep it outside the
repository, outside shared folders and outside the Docker host mounts. Do not
send it to this agent or upload it to CI. Use a terminal inside the offline VM.

Run the gate again immediately before each restore/import/inspection step and
check its exit code. If it fails, do not open any backup file. Keep the VM offline
throughout; a gate receipt is not permission to reconnect later.

- For a database backup: the owner uses trusted PostgreSQL 17 client tools,
  specifying literal `127.0.0.1`, port `55322`, and the dedicated disposable local
  database explicitly. Never accept a connection URL from the dump, shell
  environment or original manifest. Clear `PGHOST`, `PGSERVICE`, `PGDATABASE`,
  proxy variables and all hosted-service credentials. Use the local password
  through a mode-0600 local password file. Review dump compatibility and restore
  roles/schema/data in the documented format/order; do not use `--clean`, reset,
  or overwrite an existing database. Stop on every error. A hostile SQL dump can
  execute code: trust the backup source and keep the VM disconnected regardless.
- For the previously backed-up image: this is a **Storage object**, so a SQL
  restore alone cannot recover its bytes. The owner copies only the authorized
  object into the offline VM's protected working directory and checks its private
  checksum against the owner's manifest. Restore the matching Storage metadata
  or upload it with a local-only client to a newly created private local bucket.
  Fix the client endpoint to `http://127.0.0.1:55321`; refuse all other endpoints
  and redirects. Do not run the production image CLI: it intentionally uses
  hosted Supabase/R2 adapters. No R2 or GitHub credential belongs in this VM.
- Owner verifies the local original opens, expected Auth users/schema exist,
  RLS and grants match intent, the bucket is private, and anonymous direct
  download/public-object access is denied. Record local-only query/check results.
  Inspect visible PII manually; metadata stripping does not redact pixels.
- If a conversion check is desired, the owner may call the pure
  `toPrivateWebp(bytes)` function from `scripts/evidence-image-sharp.mjs` in a
  local offline script and write the output only to encrypted VM storage. It
  performs no network calls. Recheck output dimensions and absence of EXIF, GPS,
  ICC, XMP and IPTC; do not create queue records, Draft PRs or public URLs.

The owner chooses the backup-specific restore commands after inspecting the
private manifest; no universal automated restore is supplied that could target
the wrong database. This runbook deliberately does not open or guess the format
of the owner's backup.

## Receipt and disposal

Keep a private receipt with backup date, checksums, schema/Auth/Storage coverage,
isolation gate result, local restore results, RPO/RTO and owner sign-off. Only a
sanitized pass/fail summary belongs in the repository. Never attach image bytes,
raw SQL, local keys, customer identifiers or screenshots.

On any uncertainty: leave Production unchanged, detach the backup and stop. After
completion, shut down the VM and detach the original read-only disk. Keep restored
customer copies offline under the owner's retention policy. Reconnection is
prohibited until an owner-controlled process has removed those copies or destroyed
the encrypted disposable VM. This agent has not performed that operation.

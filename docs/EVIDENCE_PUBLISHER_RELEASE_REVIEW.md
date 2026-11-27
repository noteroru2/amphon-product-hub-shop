# AMPHON Evidence Publisher — release review and blocker repair

## Security-first owner approval handoff — 2026-11-27

**QA PUSH HOLD / PR HOLD / PRODUCTION NO-GO.** HEAD remains
`46bc4ec1d5d60af8111bd76ea41b6d8229c62f97` on
`codex/evidence-qa-safe-20261126`. The prior uncommitted account-verification
section below is preserved in full. The separate
[owner approval package](EVIDENCE_PUBLISHER_OWNER_APPROVAL_PACKAGE.md) contains
the exact proposed main Ruleset, Environment policy changes, one-file ONE-4B
security PR plan, sanitized dashboard checklist and approval order. No settings,
workflow, main source, remote ref or deployment was changed.

Additional successful read-only GitHub checks this turn:

- Main is still `79778626a58fd9077ca81f4655c0a19fe9896328`, unprotected.
- Direct collaborator list: one owner, **zero verified independent write-capable
  reviewers**. Both Environment reviewer rosters contain only that owner; both
  still allow self-review, with admin bypass disabled. An independent human must
  be nominated and any access grant separately approved.
- Main check-runs: **13 actual records**, including capture, Cloudflare Workers
  Builds, deploy and the ambiguous shared name verify. Combined commit-status
  list is empty. None is a verified universal non-deploying check for the proposed
  one-file security PR; the Ruleset proposal adds **no invented required checks**.
  This initial CI gap is explicit for owner review, not silently treated as PASS.
- Old main ONE-4B workflow was read again: unrestricted branch push for its script,
  workflow-wide write permission and direct `HEAD:main` push remain there. Future
  one-file repair reuses the reviewed local workflow content hash from the
  manifest; it must not merge/cherry-pick the whole Evidence commit onto main.
- Static analysis of the 37 local workflows for that sole workflow-path change
  selects **zero PR events** and **one main-push event**, the fixed ONE-4B itself;
  its writer skips while Owner Opt-in remains absent. No workflow was executed.
  Connected Cloudflare watch paths do not match that sole path, but unknown Apps
  and hooks prevent an unconditional no-deploy merge guarantee: **MERGE HOLD**.

Previously denied Apps/Vercel APIs were not retried. Owner dashboard receipts
must close those gaps without copying URLs or secrets. The proposed Ruleset has
no bypass actors and requires PR/independent approval; consequently the legacy
automated direct-main writer must stay disabled, not receive a bot bypass.
An Environment settings change must also be preceded by inspection of pending
privileged jobs; no waiting job may be released as an incidental configuration
change. The separate unfinished-body ingress criterion remains **FAIL**.

The next local commit candidate is **documentation only**, exactly this report
and `docs/EVIDENCE_PUBLISHER_OWNER_APPROVAL_PACKAGE.md`, with proposed message
`docs(evidence): prepare owner security approval and isolation gates`. It remains
uncommitted pending explicit owner approval. The original 62-path manifest and
source hashes refer to the existing commit, not this two-document candidate. A
future documentation commit has a different SHA and no inherited push approval.
The final handoff prepares only those two documents in the index; no local commit
is made. Earlier empty-index/one-modified-file statements below describe the prior
account-audit checkpoint. Existing report content was preserved by full
LF-normalized SHA-256 comparison; Ruleset JSON/control assertions pass offline.
The first preservation-harness attempt could not match a Unicode heading through
the shell pipe; the corrected ASCII-anchor check passed with the original full
content hash. This is recorded separately from application test results.

## Post-commit read-only deployment isolation verification — 2026-11-27

**QA PUSH HOLD. PR HOLD. PRODUCTION NO-GO.** Local commit is complete:
`46bc4ec1d5d60af8111bd76ea41b6d8229c62f97`, branch
`codex/evidence-qa-safe-20261126`. This section supersedes earlier pending-commit
and inaccessible-settings conclusions below; those sections remain historical
evidence. Verification snapshot recorded at approximately 11:15 Asia/Bangkok.

The owner authorized configuration reads and this report update only. No push,
fetch into local Git refs, PR, dispatch, merge, deploy, settings update, hosted
Supabase request, R2 object access or customer-backup access was performed. Provider
configuration was inspected through existing connected accounts and GET-only
GitHub REST requests using the existing Git credential helper. Credentials stayed
in process memory; this report contains no credential values or webhook URLs.
No new login, token creation or CLI installation was attempted. `gh`, `vercel`
and `wrangler` were not available as account CLI commands on PATH.

### GitHub configuration: newly obtained direct evidence

The following reads target `noteroru2/amphon-product-hub-shop`. Successful list
responses had no next page unless stated otherwise. HTTP errors are recorded as
errors, not successful absence checks.

| Check / GET endpoint suffix | Actual result | Security interpretation |
| --- | --- | --- |
| Repository metadata | **200**, owner type `User`, default branch `main`, authenticated connection has admin permission, `allow_auto_merge=false` | This is a personal-account repository. Owner-organization webhook/ruleset inheritance is not applicable; this does not inventory unrelated organizations or other accounts. |
| `/hooks?per_page=100` | **200**, empty array, no next page | No repository webhooks at this snapshot. GitHub App webhooks are separate and are not excluded by this result. |
| `/branches/main` | **200**, `protected=false` | Remote main SHA was `79778626a58fd9077ca81f4655c0a19fe9896328`. Main protection is absent, not merely inaccessible. |
| `/branches/main/protection` | **404**, message `Branch not protected` | No traditional required-review/status-check protection is established. This negative result is corroborated by branch metadata and the ruleset read. |
| `/rulesets?includes_parents=true&per_page=100` | **200**, empty array, no next page | No listed repository/inherited ruleset supplies the missing review/merge restriction. Do not describe main as protected. |
| `/actions/permissions/workflow` | **200**, `default_workflow_permissions=read`, `can_approve_pull_request_reviews=false` | Resolves the previous unknown default-token gate. Workflows omitting permissions inherit read defaults; an explicit job permission can still grant write scope to that entire job. |
| `/actions/permissions` | **200**, Actions enabled, `allowed_actions=all`, `sha_pinning_required=false` | Actions are not restricted to an allowlist or immutable SHAs. Floating third-party Actions and dependency supply chain remain a P2 consideration. |
| `/actions/variables?per_page=100` | **200**, total count **0** | ONE-4B Owner Opt-in variable is absent. Its direct variable GET also returned 404; the successful complete variable list corroborates absence. No variable was changed. |
| QA branch Git ref | **404** | The proposed remote QA ref was not found with this admin connection. No remote ref was created. |
| `/pulls?state=all&head=noteroru2:codex/evidence-qa-safe-20261126&per_page=100` | **200**, empty array | No existing PR with this head was found to receive a synchronize event. No PR was created or updated. |
| `/actions/runners?per_page=100` | **200**, total count **0** | No repository self-hosted runners are registered. Eligible QA jobs explicitly use GitHub-hosted Ubuntu/Windows runners and declare no Environment. |
| `/environments?per_page=100`, both Environment details and branch-policy lists | **200** | Both `evidence-draft-pr-protected` and `seo-production-evidence-protected` require one reviewer, allow only branch `main`, and have `can_admins_bypass=false`. Both also have **`prevent_self_review=false`**: the configured review policy fails the Evidence preflight's required independent-review condition. No executor was invoked. |
| Account `/user/installations?per_page=100` | **403**, authentication must be authorized to a GitHub App | A full installed-App inventory is **not verified**. Existing helper credentials cannot obtain this list; no broader credentials were requested. |

The GitHub connector separately returned **one accessible installation**, scoped
to the personal owner with repository selection `all`; its returned events include
PR/review/check/status events, but not push. Its repository-list operation does not
establish a complete account-wide installation or permission inventory. This is
connector-visible scope only: it cannot exclude Cloudflare, Vercel or other Apps,
their push/PR handlers, write permissions, bots or installation webhooks. This
unresolved inventory is a **QA push isolation blocker**. No claim is made that the
one visible installation is the only App installed on this repository.

### Cloudflare configuration coverage

Connected-account discovery returned **one account**, page 1 of 1. Its Workers
list contained **15 scripts**. Read every script's Builds trigger list and deploy
hook list: **15/15 trigger reads and 15/15 hook reads succeeded**, with **zero
deploy hooks**. The discovered trigger/hook APIs expose no pagination parameters;
their responses advertised no additional pages. Pages listing returned **zero
projects**, total count 0. An initial Pages request using unsupported page size
100 returned 400; retry with supported size 10 succeeded. The 400 is not treated
as evidence of absence.

| Worker linked to this repository | Verified Builds configuration | Effect of proposed QA branch |
| --- | --- | --- |
| `amphon-product-hub` | Repository owner/name exact match; branch `main`; trigger includes only `main`; automatic builds enabled; **previews disabled**. Root build is `npm run build`, action is `npx wrangler versions upload`; source/public/scripts/package/config path filters, excluding `shop/**`. | QA branch does not match. Main still has an active version-upload path; upload is a remote write even without traffic promotion. |
| `amphon-shop` | Exact repository match; branch/trigger only `main`; automatic builds enabled; **previews disabled**. Root `/shop`, paths `shop/**`, action `npx wrangler deploy`. | QA branch does not match. Main still has an active production deployment path. |

The other Workers' nonempty triggers named different repositories; none linked
this repository. Some of those other repositories permit non-production branches;
they are not evidence of a trigger for this repository. No runtime, secret-value,
image, R2 object or deployment endpoint was called. These results cover the one
connected account, not undisclosed/unconnected accounts or an arbitrary external
caller holding a separate deployment credential.

### Vercel configuration coverage and inaccessible hooks

Team discovery returned **one accessible team**; project listing returned **seven
projects**, no next cursor. Git deployment context identified six linked projects:
`buyitkorat` → `buyitkkorat`, `amphon-co-th` → `amphon.co.th`,
`rubsuekongmuesong` → same-name repository, `buyhubthai` → same-name repository,
`buyitkhonkan` → same-name repository, and `rubsueubon` → same-name repository,
all under the personal GitHub owner. The seventh project,
`amphon-r9b-measurement`, was not in that linked-project context. A team-scoped
project list filtered to `noteroru2/amphon-product-hub-shop` returned **zero**.
Thus no direct Git project linkage to this repository was found in accessible
scope. Individual project-summary reads succeeded for all seven, but those tool
responses omit deploy-hook configuration; missing fields do not prove no hooks.

`GET /v1/webhooks` returned **403 forbidden**, both in the default context and with
the explicit discovered team. No working preauthorized Vercel CLI fallback was
available. **Vercel webhook and deploy-hook coverage is incomplete.** An outgoing
Vercel webhook is distinct from an incoming deploy hook; neither is proven absent
by a project-link search. Installed integration-configuration listing for that
team returned an empty result, which does not replace either hook inventory or
the GitHub App review. No hook URL or credential value is included in this report.

### Exact-SHA Actions and synthetic QA verification

Parsed **37/37 committed workflow YAML documents successfully** from Git blobs at
`46bc4ec1d5d60af8111bd76ea41b6d8229c62f97`, using the already cached YAML parser;
no package installation or workflow execution occurred. Also read and parsed all
**35/35 live-main workflow files** through the GitHub contents API at remote SHA
`79778626a58fd9077ca81f4655c0a19fe9896328`. Main SHA was unchanged when that read
finished. Of those files, 34 match the local commit byte-for-byte; the ONE-4B
writer differs. The two new Evidence workflows are present only in the local
commit. Neither snapshot declares `workflow_run`, `workflow_call`,
`repository_dispatch`, `pull_request_target`, `check_run`, `check_suite` or `status`
event handlers that chain a QA result to an executor. Existing scheduled/manual
jobs remain separate remote-capable operations and must not be dispatched.

The workflow used by a QA **push** is the version at its pushed commit. The local
ONE-4B fix requires main in both its trigger and independent canonical-repository,
main-push, Owner Opt-in job guard. It cannot select its writer on the proposed QA
ref. **Remote main still contains the older unrestricted ONE-4B writer**; the local
commit has not repaired main. This matters for subsequent main changes and is not
permission to push/merge the fix there. Job `contents:write` remains job-scoped;
explicit final-step token env placement is not step-scoped isolation.

Potential QA push selections, subject to GitHub's path-diff evaluation:

| Workflow | Jobs that can run on this QA ref | Credentials / remote behavior |
| --- | --- | --- |
| `evidence-publisher-qa.yml` | `dry-run`, `ephemeral-sql`, `local-supabase`, `hub-storage-compatibility` | Explicit contents:read; no secret-context reference, Environment, App token, R2 binding or production deployment command. Synthetic fixtures/images, disposable Postgres/Supabase, mocked R2/GitHub. Worker command explicitly `--dry-run`. |
| `one3a.yml` | `verify` | Verified repository read-token default; source contract validation, no secret reference. |
| `one3c.yml` | `verify`, `windows-runner-smoke` | Read-token default; no secrets in these jobs; smoke uses explicit Wrangler `--dry-run` then exits. **`deploy-production` is skipped** by push+main predicate, so its Cloudflare secret is not supplied to the running jobs. |
| `one4a.yml` | `verify` | Read-token default; local contract check, no secret reference. |
| `one4b.yml` | `verify` | Read-token default; source check and explicit Worker `--dry-run`, no secret reference. |

All remaining push workflows require main or another specifically named branch.
Path selection for a new branch depends on GitHub's computed ancestry/diff and
changed-file limits; it is not necessarily just the final commit's 62 paths. The
branch predicates and jobs of **all** potentially eligible push workflows above
were checked rather than relying only on the last commit's path list.

The committed Evidence QA workflow content SHA-256 is
`cdf6c528572f781a5d60cffe85ecd635bcca304738cd8a343fdbdf8d327cd1db`.
Its local integration scripts accept only the fixed loopback endpoint; redirect
and fetch guards reject hosted destinations. Local keys are generated on the CI
runner, not drawn from repository Production secrets. Fake site/origin strings
are test data, not authorization to contact those sites. No Production secret is
declared or injected by these eligible job definitions. Actions' job-context
read token and routine dependency/setup/cache traffic still exist; this is not
network isolation against a compromised third-party dependency.

**This is source/configuration verification, not a hosted CI PASS.** No push or
workflow dispatch was performed, so actual GitHub job selection/results have not
been observed. Existing 76 unit-test and application/build evidence below was not
rerun. The separate unfinished-body ingress abuse criterion remains **FAIL**;
synthetic CI success would not resolve that platform/production release gate.

### Gates, owner approval order and final local state

| Gate | Result | Exact remaining evidence/action |
| --- | --- | --- |
| Local commit integrity | **PASS** | Original approved 62-path manifest matches committed paths; **60 content SHA-256 values PASS**, one deleted fixture path verified absent, report self-hash intentionally excluded. No committed log/env/key/backup/image filename matches. |
| Declared QA Actions isolation | **PASS (static/configuration scope)** | Exact committed source, read defaults, hosted runners, no running-job Production-secret reference, no protected executor selected. No remote run claimed. |
| Connected Cloudflare branch isolation | **PASS (one-account snapshot)** | Hub/Shop main-only, previews off, zero hooks across 15 Workers, zero Pages projects. |
| Full installed-App push/PR automation inventory | **BLOCKED / QA PUSH HOLD** | Connector list is partial; full REST inventory 403. Owner must provide authorized read access or review evidence for every repository-relevant App: event subscriptions, contents/PR/actions/deployments write scopes, auto-merge/dispatch/main-write behavior and webhook destinations without exposing URLs/secrets. |
| Vercel hooks / external account coverage | **BLOCKED / QA PUSH HOLD** | Webhook read 403 and deploy-hook configuration not exposed. Need read-only team/project hook inventory and confirmation all relevant provider accounts are covered; no direct Git linkage alone is insufficient. |
| Main write/merge safeguards | **FAIL / P1, owner decision required before push eligibility** | Main is unprotected, no rulesets, old unrestricted ONE-4B writer remains there. Owner must approve and verify adequate main-write restrictions or a separately reviewed bounded QA-only exception; neither has been approved here. No settings or main source were changed. |
| Protected executor independent review | **FAIL / production executor gate** | Both Environments allow self-review, despite main-only policies and admin bypass disabled. Evidence preflight requires prevent-self-review. Owner must separately approve any settings correction and then verify it; QA push declares no Environment/executor. |
| Ingress abuse protection | **FAIL / existing production P0** | Previously measured unfinished request still lacks proven ingress-level duration/connection bounds. No relabeling or workaround; production remains NO-GO. |
| Token/supply-chain limitations | **P2 residual** | Allowed Actions=all, no required SHA pinning, floating Actions/dependencies, and explicit writer permissions apply to the whole job. Review/accept or harden separately before enabling privileged work. |

Owner sequence:

1. Close the App, Vercel hook and relevant-account inventory gaps with authorized
   read-only evidence. Review direct and indirect main-write/dispatch/deployment
   capabilities; absence of a repository webhook alone does not close this gate.
2. Separately approve any required protection/automation configuration changes or
   a documented bounded QA-only exception. Recheck settings and exact-SHA
   isolation after any change. No such changes are authorized or made here.
3. Only after the isolation gates close, give **separate explicit approval** for
   pushing only SHA `46bc4ec1d5d60af8111bd76ea41b6d8229c62f97` to the exact QA
   branch, without tags, main updates, dispatch or an accompanying PR. Current
   conclusion is **not eligible for that approval yet**.
4. Observe synthetic CI, then request a separate CI-only Draft PR approval after
   reviewing PR-triggered Apps/hooks. Draft status does not prevent deployment.
5. Keep merge, production migrations/deployments, Publisher activation and cleanup
   disabled. Independent-review settings, ingress protection and all existing
   release gates require further owner decisions before any production approval.

Post-update local checks: **`git diff --check` PASS**, report credential/webhook-URL
pattern scan **PASS** (no literal private key, provider secret, JWT or hook URL
match), only the expected report modified, no staged files. These are bounded
content checks, not a new application test run or a complete external security
attestation.

Only this Markdown report is modified locally by this verification; index remains
empty, HEAD/branch unchanged, and no new commit is made. The report update is
**uncommitted** and is not part of the approved SHA; including it later requires
its own review/commit authorization. Earlier report/manifest hashes refer to the
completed local commit, not these newly appended findings. No secret, webhook URL,
generated log or provider-response dump was added. **QA PUSH HOLD / PR HOLD /
PRODUCTION NO-GO** remain in force.

## Owner-authorized local commit preflight — 2026-11-27

Owner authorized exactly one local commit after final gates. **PUSH HOLD, PR HOLD,
PRODUCTION NO-GO** remain unchanged. This section records the pre-commit review;
the resulting commit SHA is reported separately after the operation. No remote
operation, deployment, activation or repository-setting change is authorized.

The three corrections below are documentation, comments and matching test
descriptions only. Parsed workflow fields and shell commands (excluding comment
lines) match the previously staged workflow; test assertions/code match after
excluding comments and test titles. No functional/security behavior changed.
Targeted workflow tests **2/2 PASS**, YAML validation **37/37 PASS**; original62
approved paths/content reconciled. No application suite or upstream investigation
was repeated. The known failed unfinished-body ingress criterion remains FAIL.

**Token limitation:** contents:write belongs to the whole apply job. Only the final
push step explicitly sets GITHUB_TOKEN in its env, but access through Actions
context remains a job-level security consideration. persist-credentials:false and
env placement reduce exposure, not permission scope. This is not true step-scoped
credential isolation. Default-disabled Owner Opt-in, canonical repository and
main-push guard remain required; owner must review the complete job before enabling.

### Git Index hash convention and normalization verification

The previous workflow's CRLF byte SHA256 prefix was `aabe8a3fe4e1dd1c`; its LF
normalized byte prefix and previous Git Index prefix were both `d618ede50599ec76`.
Comparing actual original contents and alternate line endings verified the cause.
Across the original approved manifest,23 hashes reflected working-tree line
endings rather than index bytes; every difference was content-verified before
replacement. No unexplained content mismatch was accepted.

The current manifest now uses **full SHA-256 of actual staged Git Index blobs**,
computed with `git show :path`, not working-tree bytes. The workflow/test hashes
include the reviewed comment/title corrections. Deleted fixture path has no blob.
The report's own embedded hash is omitted to avoid self-reference; its actual
Index-blob SHA256 is computed and verified in an ignored local hash receipt along
with every other staged text file. Git's own blob/object IDs are distinct from
these SHA256 content checks. Nothing in the receipt or local logs is committed.

Final execution requires exact62-path cached-manifest agreement, no unexplained
blob changes outside the three authorized files, staged secret/data scan, no
unstaged source files, and cached diff check. Only those three files are restaged.
The historical staging receipts below describe earlier checkpoints, not a second
commit authorization. Production/ingress/external deployment gates stay open.

## Final staged review and deployment isolation — 2026-11-27

**LOCAL COMMIT READY for owner review; staged only, not committed. PUSH/PR HOLD;
Production NO-GO.** This is the current preparation state; older "nothing staged"
statements below describe previous passes. The 76 application tests and upstream
dispatcher investigation were not repeated: only workflow isolation changed.

### ONE-4B automated-main-write fix

Previously `one4b-apply-r2-patch.yml` accepted a matching script push from **any
branch**, ran with contents:write and pushed its checked-out HEAD to main. A
feature branch could therefore introduce unrelated ancestry into a main push,
subject to repository rules. The workflow was unsafe even if its path was not in
the earlier Evidence-only change set.

Prepared fail-closed controls:

- Trigger limited to main, paths limited to patch script or this workflow.
- Job independently requires push event, exact main ref and canonical repository,
  **plus** repository variable `ONE4B_PATCH_MAIN_WRITE_APPROVED=YES_OWNER_ENABLED`.
  Missing/different value skips the writer. No variable/settings were changed.
- Workflow token defaults contents:read; `jobs.apply.permissions.contents: write`
  is scoped to the **whole gated job**, not its final step. Checkout uses the exact
  event SHA and persist-credentials:false. `GITHUB_TOKEN` is explicitly supplied
  as an environment variable only to the final push step, but Actions context
  token access remains a job-level security consideration for other steps/actions.
  These controls reduce exposure; they do not enforce step-scoped credential
  isolation. Owner must review all actions/dependencies before enabling this job.
- Before commit/push, shell rechecks event/ref/repository and unchanged HEAD SHA.
  Credential helpers are reset; the final command's helper uses GITHUB_TOKEN.
  That command arrangement does not narrow the job-level token permission.
  Fast-forward push only, no force, PAT, protection bypass or automatic merge.
- Serial concurrency and15-minute job bound; existing deterministic patch,
  validation, dry-run and no-op behavior retained.

Operational compatibility: automatic writes are now **off by default** and cannot
be invoked from feature/QA branches, even with the opt-in set. The prior trusted-
main generation/commit flow remains available only after owner activation and main
protection permits the bot push. That opt-in is an administrative choice, not
proof of protected Environment review. If main requires PRs, keep it disabled and
submit the generated change through normal owner review; do not add a bypass.
The opt-in causes the whole apply job to skip, including generation validation.
No claim is made that this optional bot flow automatically deploys its patch:
GITHUB_TOKEN push events generally do not trigger additional push Actions, while
external Git integrations still require review.
[GitHub event/token rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Verification: **2/2 targeted workflow safety tests PASS**, including9 gate contexts
(main with absent/empty/enabled flag; QA; feature; tag; manual; PR; fork), token
placement, checkout/ref guards and fast-forward constraints. All **37/37 YAML
documents parsed** with already cached YAML2.8.3. No package install, application
test rerun, GitHub execution, patch generation, main write or deploy was performed.
The review test uses `YAML_MODULE_PATH` pointing to the cached review-tool parser;
it adds no application dependency and is outside the existing Evidence build suite.

### Whole-repository findings (exact event/paths/permissions appendix below)

Branch-triggered remote-capable workflows, beyond routine checkout/cache/npm:

- `hub-production-deploy.yml`: main path match or manual; Cloudflare Hub deploy;
  contents:read plus deployment-capable CLOUDFLARE_API_TOKEN.
- `one-bridge-deploy.yml`: main path match or manual, deploy job excludes PR only;
  Cloudflare bridge deploy/consumer activation; contents:read + CF token. Manual
  dispatch is not main-ref constrained by that job guard: do not dispatch.
- `one3c.yml`: broad branch path match for verify/Windows smoke; actual deploy job
  requires push+main. No explicit workflow permissions (repository default);
  deploy needs CF token. QA push never satisfies production job guard.
- `one4b-apply-r2-patch.yml`: main path match + canonical push/main + explicit
  owner opt-in; gated contents:write; remote fast-forward main write only.
- `store-worker-deploy.yml`: main path match or manual; actual Workers deploy and
  optional Shopee secret updates (secret put creates remote versions); contents:read
  plus CF token and optional Shopee secrets. Not a dry-run workflow.
- `shop-production-deploy.yml`: main shop/workflow paths or manual; actual Shop
  deploy; contents:read plus CF token.
- `seo-approved-webuy-20261013.yml`: main push of its own workflow; deploys fixed
  reviewed WEBUY revision; contents:read + CF token. A historical name is no guard
  against re-execution if that file changes on main.
- `seo-stock-lot-20261017.yml`: main push of its own workflow; actual amphontd
  deployment of a fixed revision; contents:read + CF token.
- **`seo-evidence-render.yml`: main path match, every10 minutes or manual; remote
  Supabase writes despite no website deploy.** contents:read + id-token:write;
  renderer calls POST render_claim/render_finish/render_fail with GitHub OIDC.
  Its allowlisted page reads do not make the ledger writes read-only.

Other remote-capable/manual/scheduled workflows: Evidence Draft executor writes
private R2, database and GitHub Drafts using protected Environment/App token;
SEO Draft executor writes GitHub/DB; SEO reconcile optionally writes DB receipt
when write_audit_receipt=true. Each needs protected activation and external
credentials/App scopes as declared, not merely contents:read. LINE learning capture
is schedule/manual only and checks out `feat/ai-buyer-v1-foundation`, supplying
Supabase and LINE secrets. Its collector script is not in this local branch;
remote write/message capability is **unverified and must be treated as potentially
write-capable**, not inferred safe. No collector branch was fetched or executed.
Manual production evidence/HTTP workflows contact live services under separate
protected gates even when intended read-only; never invoke during this QA.

All other listed jobs are local source/test/build/ephemeral fixture or explicit
dry-run entry points. This statement is about reviewed declared commands/callees,
not third-party Action/npm provenance or remote settings. Some workflows omit
permissions and inherit repository defaults. Their effective token scope remains
unverified; owner should require read-only defaults. Existing schedules operate
independently of this QA branch. No local pull_request_target/workflow_run/
repository_dispatch trigger chain was found.

For the current candidate QA push, expected matching source jobs remain Evidence
synthetic QA and ONE-3A/3C/4A/4B verification; the fixed patch writer cannot run.
Main merge still matches Hub/bridge production workflows through package/source
paths. No unconditional statement that a hosted push is deployment-free is made.

### External Git deployment/hook verification checklist — NOT VERIFIED

Before authorizing any push/PR, owner records a dated, sanitized configuration
receipt for the exact repository/head/base, with no token values:

- [ ] Inventory all linked Vercel projects/teams, Cloudflare Workers Builds and
  Pages projects/accounts, GitHub Apps, repository/org webhooks, other CI/CD,
  deploy hooks, bots and scheduled/manual dispatch services consuming this repo.
- [ ] Vercel: confirm connected repo, Production branch, preview branch behavior,
  ignored-build rules, deployment environments, auto-promotions and deploy-hook
  branch targets. Disable/exclude this QA branch and PR previews where necessary;
  preview deployment is still a remote write. Confirm build-time scripts have no
  live DB/migration/write hooks or production secrets.
- [ ] Cloudflare: inspect **both** Workers Builds and Pages Git integration,
  production/preview branch filters, automatic deployments, build/deploy commands,
  watch paths, environments/secrets, bindings and Deploy Hooks. Separate Workers
  upload/version creation from traffic promotion; both require authorization.
- [ ] Inspect webhook event subscriptions (push, PR, checks, status, deployment),
  target owners, downstream branch/ref checks, App permissions and automation
  that can write main, dispatch Actions or invoke deploy hooks. Do not expose hook
  URLs/secrets in this report or test them by sending a request.
- [ ] Verify actual default-branch and head/base workflow versions, branch/rules
  protection, required reviews and token defaults. Confirm no bot auto-merge or
  indirect main push. Previously observed allow_auto_merge=false is insufficient.
- [ ] Confirm ONE4B_PATCH_MAIN_WRITE_APPROVED absent/disabled; no main writer or
  protected executor enabled by this review. Review existing independent schedules
  separately; pushing a QA branch does not disable them.
- [ ] Owner confirms QA CI jobs have only synthetic credentials/read permissions,
  allowed resource usage and no live write/deployment secrets. Verify protections
  cannot be bypassed by administrators/self-review where required.
- [ ] Re-evaluate the complete eventual base-to-head diff and each path filter,
  not just local staged changes. No test push/PR/deploy is permitted as proof.

No Vercel/Cloudflare hook setting has been inspected/changed here. Missing local
config, workflow naming, branch name or Draft status is not proof of isolation.

### Exact remaining owner approvals and stop point

1. **Now:** owner reviews the local staged filenames/stat/diff, workflow operational
   change, tests and residual platform risk; separately approves a local commit of
   the exact index. Agent stops without committing. No deployment approval implied.
2. **Before push/PR:** complete external checklist and remote workflow/rules parity;
   approve only exact QA ref/new SHA, Draft target/base and expected CI/resource
   usage. No main push, tag, bot opt-in or manual executor dispatch.
3. **Before main writer use:** separately approve the bot patch workflow's changed
   operational contract and opt-in, exact main code and protection/token policy.
   Leave opt-in off for this project preparation; no setting changed now.
4. **Before merge/live release:** resolve ingress-abuse protection, hosted Auth/RLS/
   Storage/runtime/provider parity, backup/restore, privacy/retention, scoped keys/
   App/Environment approvals and coordinated release plan. Main merge itself can
   deploy Hub/bridge; authorize or isolate those effects explicitly.
5. Publisher enablement, mappings, real customer media and irreversible cleanup
   each remain additional owner-only approvals. Production remains **NO-GO**.

Staging was explicitly authorized for this turn; it is reversible and creates no
commit or remote event. The final manifest/index exclude logs/customer data/
backups/secrets/generated credentials and fixture-only migration contents. Guarded
synthetic fixture SQL sources remain outside migration discovery; the old tracked
fixture migration is staged only as a deletion. Existing earlier no-staging wording
below is historical. Latest full workflow audit appendix follows at the end.

## Upstream contract qualification — 2026-11-27 (current decision)

**COMMIT READY for an owner-reviewed local commit; PUSH HOLD; Production NO-GO.**
This supersedes the earlier combined commit/release HOLD classification, not the
failed ingress-abuse result. No commit/staging/push/deploy/activation occurred.
Known platform availability risk is explicit and does not by itself prevent
recording disabled code, tests and evidence in a local commit. Owner approval of
the exact manifest is still required before committing. External integration
verification is required before a push/PR; ingress proof before any exposure.

### Upstream cause and exact installed versions

- Supabase CLI **3.4.0**, also pinned in QA workflow.
- Gateway **Kong2.8.1**, image `public.ecr.aws/supabase/kong:2.8.1`, installed
  image ID `sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d`.
- Runtime image **v1.79.5**, `public.ecr.aws/supabase/edge-runtime:v1.79.5`, ID
  `sha256:2b418245cc8298f109df3c905cfe9508f0ecc71a2e3a2aabcc495d893839d502`.
  Its binary reports **edge-runtime0.1.0 / Deno2.1.4**; binary version and image tag
  are reported separately rather than assumed equal.
- Installed generated dispatcher SHA256:
  `1c7175b49d570838d1e2f5a6acf014ae27295f944a019305a3e9445155f7e3ec`.
  Code inspection confirms streamed forwarding without request clone, scoped
  remaining-body drain, and retries restricted to bodyless requests.

[PR6580](https://github.com/supabase/cli/pull/6580) removed request cloning to fix
the tee/cancellation stall reported in
[issue6564](https://github.com/supabase/cli/issues/6564). The issue's original
environment was CLI2.117.0/runtime1.74.3; that is not the installed stack here.
[PR6830](https://github.com/supabase/cli/pull/6830), merged2026-09-28, intentionally
drains unread bodies before returning responses to avoid gateway502 resets.
That preserves complete-upload early rejections but can wait indefinitely for a
sender that never supplies EOF. This is the observed contract, not evidence the
clone fix is missing. Do not undo the drain or cancel vendor streams as a shortcut.

The immutable [CLI v3.4.0 dispatcher source](https://raw.githubusercontent.com/supabase/cli/v3.4.0/apps/cli/src/shared/functions/serve.main.ts)
shows `prepareUserRequest` forwarding the body stream without clone, and lines
380–408 implement drain-to-EOF in scoped release. Installed bundle has matching
semantics. Thus the relevant fixes' behavior is included, based on tag source and
installed code inspection, not merely dates. This is not cryptographic attestation
of the CLI binary's entire build or a claim about hosted Supabase behavior.

### Separate acceptance criteria (not relabelled tests)

**Functional:** complete authorized requests deliver only authorized bounded
pixels/no-store; complete oversized/invalid requests deliver bounded generic
rejection; direct handler bounds its body wait; no unexpected writes/credentials
or replay. These checks passed.

**Ingress-abuse:** an unfinished upload must be bounded at the actual ingress
layer in size, total duration and concurrent connections, independently of a
cooperative client or function handler. Prompt gateway rejection before8s remains
**FAIL / NOT SATISFIED**. Client cancellation at8s is a separately measured PASS,
not ingress protection. The new contract runner exits **2**, preserving the failed
abuse gate; the earlier unfinished-body regression is not changed to PASS.

### Fresh A/B/C execution, stock gateway and normal production entry

Fresh synthetic historical-Hub schema; both proposed migrations in order. Only
`http://127.0.0.1:55321` accepted by the runner; redirects/non-local destinations
denied. No dispatcher patches, buffering edits, diagnostic service-role fault
entry or JWT relaxation were used in this pass. `scripts/verify-evidence-dispatcher-contract.mjs`
records only status/duration/byte counts/booleans, never tokens or records.

| Case | Route | Status | Duration ms | Result |
| --- | --- | --- | --- | --- |
| A valid Owner PREVIEW | Gateway | 200 | 40 | Functional PASS,274 synthetic image bytes/no-store |
| A valid Owner PREVIEW | Direct shared handler, real Local Auth/SQL/Storage | 200 | 36 | Functional PASS |
| B complete oversized request1025 bytes | Gateway | 422 | 12 | Functional PASS,15 generic error bytes |
| B complete oversized request | Direct handler | 422 | 1 | Functional PASS |
| B complete invalid JSON | Gateway | 403 | 9 | Functional PASS,13 generic error bytes |
| C unfinished chunked body | Direct handler | 422 | 5003 | Handler deadline PASS; zero upstream calls |
| C unfinished chunked body | Gateway | none | 8013 | **Prompt rejection FAIL**; client cancellation PASS,0 response bytes,1 attempt |
| A valid after C disconnect | Gateway | 200 | 30 | Availability recovery PASS |

Results: `.evidence-dispatcher-final.log` / `.evidence-dispatcher-contract.log`;
suite exit2 for unmet abuse gate. First repeat also showed A129ms, B422/12ms,
C direct5003ms, C gateway8010ms and recovery41ms; not summed with final run.
Node76/76 unit/security tests rerun and passed; `.evidence-dispatcher-unit.log`.
Prior build145/typecheck/audit/dry-run results below remain prior executed evidence;
application code/dependencies were not changed in this upstream qualification.

### Security and ingress risk assessment

- C returned **zero bytes**; direct C made **zero Auth/SQL/Storage calls**. Valid
  A still requires actual JWT, live staff/session and consent. No unsafe auth
  workaround or image-disclosure path was introduced.
- Snapshots of synthetic evidence, image metadata and publication requests before/
  after C were equal. Handler has no write operation; no queue/PR/R2 side effect.
  This does not assert that all vendor telemetry/internal DB bookkeeping is absent.
- Every complete response was checked against the actual local user token,
  service key and JWT secret and contained none. Values were not printed. Local
  test keys are ignored/disposed; no Production credential/backups were opened.
- Exactly one raw HTTP C attempt; no automatic upload retry. Dispatcher retry guard
  applies only to bodyless requests. A new post-cancellation request is an explicit
  separate test, not a retry of C.
- Per-handler retained input/output are capped at1KiB/8MiB; oversized chunks are
  rejected before accumulating them. Owned read deadlines cancel application
  readers. Dispatcher drain discards stream chunks rather than collecting the
  full body. **No global memory/connection safety certification:** gateway buffers,
  vendor runtime, chunk allocation, concurrency and disk/network use remain
  platform resources. A single tiny unfinished request is not a load/memory proof.
- Local generated gateway has `client_max_body_size 0` at the proxy level and
  request buffering on for the normal route. It also has16384 worker connections;
  that is not a per-user/function abuse limit. No tested per-function absolute
  upload deadline/concurrency policy exists. Handler5s is not a client ingress
  deadline. A separate10m directive elsewhere is not asserted to protect this route.

Nginx can enforce [body size and idle read timeout](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_body_timeout)
and [keyed connection limits](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html).
Idle timeout measures gaps, not total upload duration; a slow continuous sender
needs a verified absolute request budget/minimum-rate policy at a controlled
ingress. A production ingress plan must enforce/test all three and cancellation
cleanup under concurrent/slow uploads. No managed Supabase/Cloudflare control is
claimed configured, available or verified. No ingress infrastructure was created.

### Commit decision, hooks and owner gates

**Local reviewed commit: COMMIT READY**, limited to disabled implementation,
synthetic tests and truthful risk documentation. This records a known upstream
contract; it does not certify resistance to slow-upload abuse. Do not run a
deployment to settle it. Owner reviews the exact local staged diff/manifest before
separately authorizing commit; no approval is implied by this readiness label.

**Push/PR remains HOLD:** checked source still deploys Hub and ONE bridge on main;
exact QA branch runs synthetic CI/dry-run. Normal Draft PR triggers checks, not a
local-source deployment job. External Vercel/Cloudflare/GitHub build hooks/rules
were not reconfigured or certified; absence of local Vercel config proves nothing
about external integrations. Owner verifies those before authorizing any push.

**Production NO-GO:** actual ingress limits/managed-platform parity, provider
contracts, live JWT/RLS/Storage/Environment/App scope, offline backup restore,
retention/privacy and coordinated release approvals remain required. Local commit
readiness is independent of these live activation gates. All prior no-deploy/no-
publish constraints remain. No commit, push or deploy occurred.

Manifest excludes all logs (including `.evidence-gates-review-content.log`),
generated keys/data/package, backups and fixture-only migration content. The old
tracked fixture migration is a **deletion**; guarded test SQL sources are outside
migration discovery. New contract test is an explicit source entry. Do not use
force-add or broad staging; scan actual index before an owner-approved commit.

The earlier combined **COMMIT HOLD** sections below are historical and superseded
only for local commit eligibility. Their failed abuse measurements remain valid.

## Latest ingress diagnosis — 2026-11-27 (supersedes earlier B9 analysis/counts)

**HOLD commit/push; Production NO-GO. The remaining ingress blocker is NOT closed.**
Safe application changes improve cancellation; the stock Local CLI dispatcher has
an unbounded post-handler request-body drain that this function cannot control.
Do not report the whole gateway suite as passing: latest run **12 PASS / 1 FAIL**,
exit1. No JWT validation, authorization or consent check was disabled.

### Verified request chain and smallest safe change

- Gateway's generated Nginx location initially used `proxy_request_buffering on`.
  Turning it off temporarily on the disposable gateway preserved Kong routes/JWT
  and did not resolve incomplete-body failure. Function watcher/restart regenerates
  that config, so modifying a running gateway is not a durable deployment fix.
- Runtime dispatcher `/root/index.ts` in CLI3.4.0 / edge-runtime1.79.5 acquires the
  incoming body reader before dispatch, then its scoped release runs
  `dle=e=>e===void 0?G.void:zl.runDrain(e4(e)).pipe(G.ignore)` before returning the
  handler response. This drains an unterminated request without a deadline.
- With streaming enabled and a raw Node HTTP client (not just fetch half-duplex),
  privacy-safe entry/exit logs showed handler return **422 after 5,008ms** while
  client got no response before its **8,003ms** bound. No Auth/SQL/Storage phase
  was reached for that incomplete body. Source plus timings locate the residual
  wait after the handler, in dispatcher body cleanup; it is not an eight-second
  database, JWT or cold-start computation. Latest default-gateway repeat also
  failed at8,006ms. An idle/pre-handler gateway limit is a distinct concern.
- Normal first owner request119ms versus warm32ms; handler31/23ms, normal Auth
 3–6ms, SQL3–14ms, Storage7–8ms. Remaining first-request overhead includes gateway/
  JWT/worker initialization; those components were not separately instrumented.
  Startup watcher transitions produced transient502s. Test runner now waits at
  most10s for dispatcher health before tests, without retrying timed requests.
- Application fix: owned AbortController timers, explicit parent propagation and
  finally cleanup, instead of depending on composite timeout signals/transport
  abort to stop a stalled body reader. Storage response read now has its own15s
  bound, as do upstream calls; input5s and overall60s limits retained. No timeout
  increase. A new regression tests a Storage stream that ignores transport abort.
  No universal runtime AbortSignal defect is asserted from these experiments.
- Local diagnostic entry is guarded by `LOCAL_ONLY` flag and HTTP Local service
  URL, stored only as a test fixture, never copied by production bootstrap/package.
  It runs the real handler behind actual gateway JWT checking and adds timing
  headers only. Synthetic Storage stall/overflow and mid-read consent withdrawal
  are injected there; Auth/SQL/initial private Storage read remain real Local.
- An ephemeral dispatcher-finalizer A/B attempt was **not executed successfully**:
  runtime image lacked standalone Deno CLI; Docker restart caused CLI watcher to
  remove its container. No dispatcher patch was installed or retained. Skipping
  body cleanup is not proposed as a safe fix. A reviewed upstream dispatcher fix
  (bounded cancellation/drain) or separately verified ingress architecture and
  rerun of this exact case is required. No such version is claimed verified here.

### Actual gateway measurements (latest source, `.evidence-ingress-complete.log`)

| Case | Status | Duration ms | Result |
| --- | --- | --- | --- |
| Owner first/cold private preview | 200 | 119 | PASS |
| Owner warm private preview | 200 | 32 | PASS |
| Admin private preview | 200 | 42 | PASS |
| Anonymous | 401 | 11 | PASS denial |
| Sales/staff | 403 | 27 | PASS denial |
| Expired JWT | 401 | 8 | PASS denial, gateway rejects before handler |
| Revoked session | 401 | 14 | PASS denial via real Auth/session checks |
| Request over1KiB | 422 | 11 | PASS |
| Response over8MiB, synthetic fault | 403 | 30 | PASS, no pixels |
| Consent withdrawn between Storage read and postcheck | 403 | 32 | PASS, no pixels |
| Stalled Storage response, synthetic fault | 403 | 15023 | PASS, handler15010ms |
| Missing/unavailable function entry | 404 | 5 | PASS fail-closed, no pixels |
| Unterminated chunked incoming body | no response | 8006 | **FAIL**, client abort |

Missing entry is distinct from stopped runtime: during the restart experiment,
runtime absence also returned503 in2–5ms; that trial is not a clean suite PASS.
Successful previews were checked for no-store; handler error/no-store and both
byte-bound regressions are covered by unit/Local matrix tests. Gateway-generated
errors are outside the handler's no-store guarantee. Timing contains only case
names/status/durations/phase categories, no image identifiers, bytes or JWTs.

### Final verification and release safety

- **76/76 unit tests PASS**, zero skip/fail; `.evidence-ingress-unit-final.log`.
- **20/20 historical Hub scenarios PASS** through actual Local Edge with the
  normal production entry, `.evidence-ingress-hub.log`. The unchanged journal's
  prior25 recovery results remain earlier evidence, not a new run in this pass.
- Typecheck and full build **PASS exit0**; build145 Node tests across13 summaries,
  PWA8 entries/output smoke; `.evidence-ingress-type-final.log`,
  `.evidence-ingress-build-final.log`. Counts overlap unit runs.
- Official npm audit **PASS**, all severities0; Worker dry-run **PASS** (13.54KiB,
  only disabled dispatch/origin variables, no R2 binding). No deploy.
- Earlier failed trials (original abort helpers, watcher502s, transient unavailable
  runtime, mismatched expected401/403 and404/503) are not counted as PASS. Latest
  suite explicitly retains incomplete-body failure; it is not silently skipped.
- Local log/config excerpt accidentally exposed generated **synthetic Local keys**
  in a tool result. No Production credential was involved; values were not copied
  into code/report. Entire Evidence stack and ignored keys/copies are disposed
  after tests. Do not reuse/share those diagnostic keys; tool history cannot be
  erased by repository cleanup.
- `.evidence-gates-review-content.log` and timing logs match `*.log` ignore;
  `git ls-files '*.log'` returns none. They are absent from reviewed manifest;
  ignore rules do not prevent a deliberate force-add. Generated data/keys remain
  excluded. The diagnostic fixture and executable test source are explicit entries.
- Rechecked local Actions: exact QA push runs synthetic checks; main push/merge
  can deploy Hub and ONE bridge to Cloudflare. No local Vercel config was found;
  that does not prove absence of Vercel/Cloudflare/external Git integrations.
  Remote build hooks/rules/Environment settings remain unverified. No push/PR/
  deploy was performed; B1, B5, B7, B8 and owner privacy gates remain open.

**Commit eligibility:** package remains local and uncommitted, HOLD. Owner must
review the complete final diff/manifest; resolve the dispatcher/ingress contract
or explicitly scope a CI-only investigation PR that retains this blocker; verify
external deployment isolation before authorizing any push; separately authorize
commit and Draft PR. Production still requires target JWT/policy/runtime/provider
validation, offline restore proof and all previously ordered approvals. No live
operation is awaiting execution approval in this turn.

Updated **2026-11-27, Asia/Bangkok**. Repo `noteroru2/amphon-product-hub-shop`;
branch `codex/evidence-qa-safe-20261126`; unchanged HEAD
`407a314533e5d206f29d78b02c75aa58d9637e26`. No staging, commit, push, merge,
deployment or enablement. Only synthetic Local Supabase records/images used.
No customer backup/media, hosted Supabase, Production secrets, real R2 objects,
paid infrastructure or production App installation accessed. GitHub repository
metadata was read through the connector; no remote write/workflow dispatch.

**HOLD commit/push; NO-GO Production.** Local packaging, historical Storage
compatibility and explicit Edge JWT settings are repaired and tested. A real
Local Edge stalled-ingress experiment did not establish an input deadline before
the handler; external deploy hooks and hosted security settings remain unverified.
This version supersedes the earlier release review's findings, manifest, counts
and QA push-filter analysis. Earlier execution history remains in the final QA doc.

## Findings and current disposition

| Gate | Result / remaining requirement |
| --- | --- |
| B2 / P0 migration packaging | **Resolved for supported discovery/package/runner paths.** No test-only migration remains in a migration directory. Guarded baseline/clock sources moved to tests/fixtures; fixed local Docker runner applies them without generating migrations. Exactly two production schemas in the review artifact. Fresh ordered/atomic rehearsals and three ordinary-copy denial checks passed. |
| B3 / P0 Storage compatibility | **Local engineering matrix passed, 20 scenarios.** Replayed actual historical evidence tables/triggers/RLS/Storage policies. Added narrow authorized metadata-list helper; signing/public bytes remain denied. First draft's direct table reference broke the default-deny server fixture; helper fixed it, then fresh recovery suite passed. Actual hosted version/policy parity still requires owner preflight. |
| B4 / P0 Edge auth | **Code/config resolved locally.** Root and Local configs explicitly require verify_jwt=true. Actual Local Edge rejects invalid/forged/expired JWTs and stale signed-out sessions; handler getUser and live SQL checks remain. Hosted signing/gateway/runtime settings remain unverified; do not disable JWT validation to clear a 401. |
| B6 / P1 preview/export | **UI mismatch fixed:** export button is Owner-only. Backend export remains Owner/review gated. Owner/Admin PREVIEW delivers pixels either can save independently; export action cannot enforce a copying ban. Consent-false previews intentionally denied, staff metadata listing/erasure retained. Owner privacy acceptance remains required. |
| B9 / P0 bounds | **Handler fixed, ingress still BLOCKED.** Five-second cancellable handler input, 60-second overall handler/response budget, 15-second upstream calls, 1KiB request and 8MiB response. Unit stalled-stream/overflow tests pass. Actual Local Edge ingress probe instead hit client timeout at **8,011ms**, exit **2**. Input may wait/buffer before reaching handler; actual upstream limit is unverified. Require tested ingress control before exposure. |
| B1 / P0 no-deploy push safety | **Externally BLOCKED.** Local QA push now matches the exact current branch and runs synthetic CI/dry-run. Read-only GitHub metadata confirms default main, public repo and allow_auto_merge=false. Available connector tools do not certify complete hooks, Cloudflare build/preview settings, Environment protections or branch rules. Owner must verify CI-only review path before push; Draft status is not a deploy interlock. |
| B5 / P1 provider/writers | **Owner-only gate:** real R2/GitHub contract/permission testing with synthetic assets in isolated existing resources, exclusive cooperative journal writers and old-runner quiescence. Fencing cannot revoke a provider request already received; later consent/approval withdrawal cannot promise rollback of PUT/PR/DELETE. |
| B7 / P1 recovery/privacy | **Owner-only gate:** privately verified offline restore/Auth/Storage/RPO/RTO and rollback plan, old-client transition and independent-copy exposure acceptance. No backup is delegated to the agent. |
| B8 / P1 live configuration | **Owner-only gate:** actual hosted schema/helpers/policies/session/JWT mode, project-wide elevated key exposure, private bucket/domains, App scope, Environment reviewers/self-review/bypass, exact base/release head and hosted CI. No Production preflight was run. |
| B10 / P2 operations | Unknown negative-HEAD outcomes stay held indefinitely; unknown legacy objects lack deletion proof. Define orphan branch/PR and metadata/audit retention procedure. Cleanup stays disabled and Worker has no R2 delete grant. |

No new demonstrated P0 exploit was found. Real unresolved ingress and push-safety
gates still prevent release approval. Local successes do not waive owner gates.

## Migration discovery, copying and review artifact

Root discovery contains **142 SQL files**, all inventoried below. A generic root
CLI migration command could consider every unapplied entry; hosted history is
unknown. This is not a list of 142 authorized pending migrations. No root db push,
reset or hosted migration operation was executed.

Production Evidence allowlist, in order:

1. `supabase/migrations/20261124_evidence_publisher.sql` (tracked/unchanged):
   private queue/page mappings; RLS/browser grant denial; explicit service grants;
   uniqueness, FKs and Draft/release constraints. No enabled rows/publication.
2. `supabase/migrations/20261126160233_evidence_recovery_local_qa.sql` (proposed
   **production** migration despite suffix): private journal/media/approvals/audit/
   disabled policy, fenced checkpoints, locked retention/tombstones, live Owner
   approval/revocation, atomic queue receipt and private-access/Storage policies.
   New list helper checks live staff plus evidence path without coupling Storage
   authorization to browser SELECT privileges on the simplified server fixture.

Both still need target object/grant/FK/helper/session compatibility, migration
history and lock/rollback preflight. Apply once atomically, not as a generic
rerunnable repair. Service role remains project-wide trusted authority.
RELEASED metadata constraints do not attest an actual deployed SHA. No public
bucket/media route/R2 binding introduced; public publication remains out of scope.

`node scripts/evidence-migration-package.mjs` creates ignored
`.evidence-review-package/`: **exactly two SQL files and manifest.json**, byte
hashes and all root discovery names. No destination/hosted argument, apply or
network command. Tests verify exact byte copies and reject unexpected package
files. Fixture/clock are absent from this deployment-review artifact.

Tracked test migration `20261125000100_synthetic_fixture.sql` was deleted from
test migrations and moved to `tests/fixtures/evidence-local-baseline.sql`.
Former untracked clock migration `20261125000400_recovery_test_clock.sql` was
removed; source is now `tests/fixtures/evidence-local-clock.sql`. Additional
dependencies live in `tests/fixtures/evidence-hub-dependencies.sql`.

Test migration directory is empty/ignored and regression-checked. CLI start
creates an empty stack. `scripts/evidence-local-bootstrap.mjs` checks exact test
project/no hosted link, explicit local Docker socket, named container/image/port/
running identity and fixed SQL file allowlist. It strips Docker/PG override env
and feeds SQL transactionally with an explicit local-only session flag. Its CLI
accepts no URL, SQL or arbitrary file. No fixture migration generation/copying.
All three fixture sources reject execution before DDL without that flag; clock
also checks synthetic marker schema. Ordinary-copy negative tests passed 3/3.

Deliberate privileged SQL editing/flag forgery can bypass a source guard; no
repository can prevent hostile manual DBA work. Supported discovery, normal CLI/
SQL copying, the reviewed artifact and current CI cannot apply these fixtures
hosted. Whole-repository archives are not approved migration artifacts. Do not
copy test SQL into hosted projects or use blanket root migration application.

Fresh server transaction: baseline → base → recovery → guarded clock; then
25 recovery scenarios plus two-site Sharp E2E, genuine Local Auth/Storage/Edge,
R2/GitHub in-memory only. Fresh Hub transaction: synthetic unrelated dependencies
→ actual `20261118135133_trade_evidence_library.sql` →
`20261118135336_trade_evidence_anon_revoke.sql` →
`20261118135723_trade_evidence_approval_edit_guard.sql` → base → recovery;
then actual Local Hub matrix. Hub mode installs no clock. Unrelated profile/site
dependencies remain synthetic; not a full historical finance/Hub or hosted replay.

## Executed Hub Storage/Auth/Edge matrix

`scripts/verify-evidence-hub-compat.mjs` refuses non-literal-local origins and
redirects; uses synthetic JPEGs/users and actual historical evidence policies.

| Behavior | Actual outcome |
| --- | --- |
| Owner and Admin image upload + scoped metadata insert | PASS for both |
| Owner/Admin evidence/image metadata listing and Storage listing | PASS, including consent withdrawn; metadata only |
| Private preview and cross-staff internal library access | PASS through actual Local Edge |
| Authenticated private download | PASS for live Owner/Admin with consent, denial when revoked/inactive |
| Owner/Admin deletion using Hub order (metadata then object) | PASS including consent withdrawn; erasure preserved |
| Anonymous/sales upload, metadata, download, signing, preview/public route | PASS denial |
| Unauthorized/new signed URL creation, including Owner/Admin | PASS denial; no new Hub bearer links |
| Consent revoked during access | PASS shared handler with real SQL/Storage injected post-download withdrawal; next-request actual Edge denial also PASS |
| Evidence creation/edit, approval, approved edit revocation/reapproval | PASS for both roles with historical guards |
| Revoke → restore consent → reapprove | PASS: PREVIEW resumes with consent; EXPORT stays denied while DRAFT, resumes only after approval |
| Invalid/forged/expired JWT, wrong CORS, GET, oversized body | PASS actual Local Edge denial |
| Stale signed-out session, inactive Admin | PASS actual Edge denial; direct Storage denial covered by matrix/recovery suite |
| Historical bearer URL after consent withdrawal | CONFIRMED limitation: HTTP200 until expiry/object erasure |
| Historical bearer URL expiry | PASS: accepted 1-second synthetic link initially, denied after 2.2 seconds |
| Stalled stream via actual Local Edge ingress | **NOT VERIFIED / BLOCKED**, client timeout 8,011ms rather than five-second response |

Total **20 PASS scenarios**; separate ingress experiment is not counted as PASS.
First matrix run failed its overstrong end-to-end timeout assertion. That assertion
is now a separately reported deployment blocker, not silently declared passing.
Final matrix rerun covers supported behaviors; no original/user data was used.

Intentional changes: staff can list metadata, new signing denied, consent-false
previews/downloads denied, Admin export button removed. Tested upload, create/edit
and erasure permissions preserved. Target-version policy parity remains a gate.

## Full private-media source/auth/bounds review

Read the full shared handler and Deno entry. Both config files explicitly require
gateway JWT checking. Handler getUser uses Auth to validate the user token; no
decoded/user_metadata role trust. SQL checks actual live session_id, current
profile active/role, image/evidence relation, consent and purpose/review. Checks
repeat after Storage read and require unchanged version. No service key/public GET.

Only configured Hub Origin may POST/OPTIONS. Controlled success/errors use
private/no-store, expiry zero, nosniff and Vary Origin/Authorization. Generic errors
never expose upstream details/paths/tokens. Bounded JPEG/PNG/WebP only; all fetches
deny redirects/use user token and 15-second timeouts. New cancellable handler input
read is five seconds; overall handler/response read budget 60 seconds. Overflow,
unsafe MIME, upstream error and stalled handler stream tests passed. No claim
that those budgets control request ingress before handler invocation.

Actual Local runtime: edge-runtime1.79.5 / Deno2.1.4, CLI3.4.0, HS256 user JWTs.
Hosted signing/gateway/runtime mode unverified. Retain verify_jwt=true per
[official guidance](https://supabase.com/docs/guides/functions/auth); do not
disable it speculatively. Verified upstream ingress control/matching deployment
test remains necessary before exposing this function.

## Revocation: code guarantees and owner acceptance

New requests recheck live authorization/consent/session before/after private read.
New signing denied, stale sessions/EXPORT approvals denied. Controlled function/
browser transport uses no-store; Blob URLs expire/refresh/clear on session and
visibility changes; stale responses fenced. New service worker activation removes
known historical private cache entries. Staged WebP metadata is stripped; private
preview original is not pixel redaction.

Historical signed URLs are bearer capabilities: Local experiment confirmed they
can remain usable after consent withdrawal until expiry/object change/deletion.
No original deletion or signing-key rotation performed. Old installed PWA clients
must receive/activate the new worker; offline clients cannot be forced to update.
Already rendered/downloaded/cached/captured or independently copied pixels cannot
reliably be revoked. Admin authorized to PREVIEW can save the same bytes. These
limits require owner acceptance, not a claim that hiding EXPORT prevents copying.

Coordinate schema/policy/function/Hub/SW transition. Old signing clients break if
restrictive policy ships first; new Hub previews break if RPC/function are missing.
Approve a maintenance/transition plan, drain old runners, verify SW activation.
Cleanup/Publisher remain disabled, unknown objects held, Worker no R2 delete grant.

## No-deploy workflow and repository audit

37 local workflows were previously reviewed; changed QA jobs/triggers and deploy
predicates rechecked; all37 YAML documents parsed. Read-only GitHub connector
metadata reports default `main`, public repo, `allow_auto_merge=false`. No remote
settings changed. Available connector tools cannot certify complete webhooks,
Cloudflare build/preview hooks, branch/rules and Environment protection settings.
These remain explicit assumptions/blockers before push.

| Event | Current source prediction, not hosted execution evidence |
| --- | --- |
| Push exact current QA branch | Evidence QA **now matches**; existing ONE-3A verify, ONE-3C verify/Windows smoke, ONE-4A verify and ONE-4B verify/dry-run also match package.json. ONE-3C production job skipped by exact push+main guard. |
| Evidence QA | contents:read; no secret/App/cloud write token. Unit/typecheck/build/dry-run, ephemeral SQL/restore, separate local recovery and historical Hub jobs. Fixed local runner, no test migration copying, hosted URL, cleanup schedule or Publisher activation. Generated local keys/dump not uploaded. Third-party setup/npm/Actions cache activity is expected CI network traffic. |
| Draft PR main | Evidence QA plus matching Hub/Shop, ONE-3C/4A/4B/4C/4D/4E, SEO and trade-economics verify jobs. Normal pull_request runs for Drafts. No matching reviewed local PR job deploys; remote versions/base-to-head diff remain to verify. |
| Merge/push main | **Actual automatic Hub and ONE-3C bridge deploy match this package.** Never merge just to obtain CI; gate deploys or explicitly approve their effects before release. |
| Manual/other | Protected Evidence/SEO executors are dispatch-only; do not invoke. Schedules independent on existing refs. No reviewed local pull_request_target/workflow_run/repository_dispatch chain. |

Called verification scripts use source contracts, Windows runner-smoke or explicit
Wrangler dry-run; names QA/NO DEPLOY were not proof. Some unrelated workflows lack
explicit permissions; actual default token scope needs review. Floating Action
tags remain maintenance risk; do not expose live secrets to QA. GitHub's
[event rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
do not certify uninspected external integrations. No unconditional safe-push claim.

## Final actual verification

All final runs 2026-11-27; counts overlap.

| Check | Actual result |
| --- | --- |
| `node --test tests/evidence-*.test.mjs tests/trade-evidence-economics.test.mjs` | **PASS75/75**, 0 fail/skip; `.evidence-gates-tests.log` |
| Migration discovery/package/config tests | **PASS3/3** inside suites; 142 root files/no fixtures/exact two-schema artifact |
| Fresh server baseline + base + recovery + clock, ordered atomic bootstrap | **PASS**, exit0 |
| Real Local recovery/Sharp/two-site Auth/Storage/actual Edge | **PASS25 scenarios** plus main E2E, exit0; `.evidence-gates-recovery.log`; R2/GitHub mocked |
| Fresh historical evidence schema/policies + both publisher migrations | **PASS**, atomic bootstrap exit0; no clock in Hub mode |
| Actual Local Hub Storage/Auth/Edge matrix | **PASS20 scenarios**, exit0; `.evidence-gates-hub-matrix.log` |
| Ordinary SQL copying of guarded baseline/clock/Hub fixtures | **PASS expected denial3/3** before DDL without runner flag |
| Actual Edge stalled-ingress diagnostic | **BLOCKED exit2**, `HOLD_UNVERIFIED_INGRESS_TIMEOUT`, client8s/observed8,011ms; `.evidence-gates-ingress-probe.log` |
| `npm.cmd run typecheck` | **PASS exit0**; `.evidence-gates-typecheck.log` |
| `npm.cmd run build` | **PASS exit0**, **144 Node tests** across13 TAP summaries, existing source contracts/WorkerTS/tsc/Vite/PWA/output smoke; 8 precache entries; `.evidence-gates-build.log` |
| Official npm dependency audit | **PASS exit0**, all severities0; `.evidence-gates-audit.log` |
| Worker dry-run, inherited Cloudflare token/key cleared, metrics off | **PASS exit0**, Wrangler4.168.0,13.54KiB, disabled dispatch/origin variables only/no R2; `.evidence-gates-worker.log` |
| Pinned YAML2.8.2 validation | **PASS exit0**, all37 workflow docs; no dispatch |
| `git diff --check` | **PASS exit0**, CRLF informational warnings only |
| Final secret/data content and filename scan | **PASS within bounded scope:** 57 candidate paths, 56 text files scanned, 1 deletion, zero findings; `.evidence-gates-secret-scan.log` |
| Local stack stop --no-backup | **PASS exit0**, Evidence project only; ignored local keys/function copies removed |

Superseded failures: sandbox CLI telemetry/Docker denial (approved local-tool
access rerun); guard initially rejected CLI-generated local branch marker (now
checks actual hosted-link metadata); input cancellation ordering unit failure
(fixed); packaging assertion matched a comment (fixed); first list policy denied
server-fixture downloads (helper fix + fresh rerun). Ingress failure remains open,
not superseded by the passing matrix. Bundle-size/deprecated local Auth config
warnings non-failing. No deliberate denial or failed prerequisite is a PASS.

Secret scan checked private-key blocks, provider token/JWT literals, credentialed
database URLs, inline images, binaries and credential/media/backup filenames;
manual review covered synthetic fixtures and environment references. It was a
redacted custom pattern scan, not Gitleaks/TruffleHog certification or proof against
every unknown secret format. No real media/backup/credential is in the manifest.
Ignored logs/package/credentials must never be force-added; review the entire
eventual remote-base diff as well, since pre-existing feature commits are outside
this working-tree scan. The shared report hash is intentionally omitted.

## Safe CI-only Draft PR procedure and owner approval order

1. Review exact current manifest/diff; choose existing #181 vs separate Draft/base.
   Compare entire eventual base-to-head diff, including prior feature commits;
   this manifest is local changes from current HEAD, not the entire remote PR.
2. **Before push**, owner verifies remote workflows and absent/gated production/
   preview build hooks for this head/base, no bot dispatch/merge, safe token defaults
   and protected main/Environments. Auto-merge=false alone is insufficient. If not
   proved, share local package only; keep HOLD.
3. After exact staged-diff/secret/packaging review, obtain separate approval for
   local commit, then exact current QA-ref push and one Draft PR. No approval is
   requested for execution now. Use explicit manifest, no broad/force staging of
   generated credentials/artifacts. Include old fixture migration deletion and
   guarded fixture sources outside discovery.
4. Title `[DRAFT][CI ONLY][NO DEPLOY] Evidence Publisher release gates`; body lists
   actual results, ingress failure and owner gates. Disable merge, no production/
   executor dispatch, no deployment labels/customer artifacts. Observe expected
   synthetic jobs for exact new SHA; QA push filter now matches current branch.
   Unexpected deploy/hook is a hard owner stop. Draft/skip-ci labels are no interlock.
5. CI-only review can record unresolved deployment ingress gate, but green unit/
   build is not release approval. Prove a matching non-production ingress limit,
   hosted JWT/policy/runtime compatibility and separately authorize target read-only
   preflight before function exposure. Keep all unresolved gates explicit.
6. Owner privately completes offline restore and approves rollback/lock/retention/
   old-client/copy limitations. Approve isolated synthetic provider contracts,
   cooperative writer quiescence and dedicated scoped credentials/App installation
   separately; no paid resource approval implied.
7. Only after applicable gates/exact-head CI: approve concrete merge/coordinated
   schema+Edge+Hub+Worker plan. Main merge triggers real Hub/bridge deploy unless
   separately gated first. Approve exact two Evidence migrations and pending
   history, never blanket root migration application. Publisher activation,
   mappings, customer-media use, cleanup enablement and each irreversible deletion
   need further explicit owner approval. Keep Publisher/cleanup disabled during QA.

Owner recovery: [offline rehearsal](EVIDENCE_PUBLISHER_OFFLINE_OWNER_REHEARSAL.md).
Background: [final QA history](EVIDENCE_PUBLISHER_CODEX_FINAL_QA.md),
[retention protocol](EVIDENCE_PUBLISHER_PRIVATE_RETENTION_REVIEW.md).
No live operation awaits permission in this turn.

## Current reviewed commit manifest

Every modified/new/deleted path is below. Supersedes former48/49-file manifest.
Candidate does not authorize commit. Guarded test SQL **sources** may be reviewed;
there is no fixture migration to commit. Stage deleted path as deletion, never
reintroduce it. Full hashes are actual Git Index content SHA-256. Report self-hash is externally verified, not embedded.
Generated package/logs/keys are excluded.

| # | File | State | Git Index content SHA-256 | Purpose |
| --- | --- | --- | --- | --- |
| 1 | `.github/workflows/evidence-publisher-qa.yml` | M | `cdf6c528572f781a5d60cffe85ecd635bcca304738cd8a343fdbdf8d327cd1db` | Match exact QA push branch; four secret-free QA jobs, fixed local bootstrap and historical Hub matrix; dry-run only. |
| 2 | `.github/workflows/one4b-apply-r2-patch.yml` | M | `6c74c78f9c5073069fc02ebb10c592c1b73d252c509cef1bb70e71578e53b30e` | Fail-closed canonical main push + owner opt-in; exact SHA/no persisted credentials; job-scoped write permission; final step explicitly sets token env; feature/QA writes denied. |
| 3 | `.gitignore` | M | `9c8c790864afcd6123a4c0fca2df389c0b17f4b57687ebd7a2aa866f86104486` | Exclude local credentials, generated functions/review artifact and all test migration SQL. |
| 4 | `docs/EVIDENCE_PUBLISHER_CODEX_FINAL_QA.md` | NEW | `11eb1b39259a351fdd68370fc62c981ff44f6f7b8cbb912b86e02c475c4d8540` | Historical QA evidence and pointer to latest repaired gates/results. |
| 5 | `docs/EVIDENCE_PUBLISHER_FREE_PLAN_BACKUP_AND_MIGRATION_RUNBOOK.md` | M | `579b6460a7e51792dd1efe5bea487d432e9da28c753ee2e2222b818128392c4a` | Link stricter offline owner gate; correct synthetic dump description. |
| 6 | `docs/EVIDENCE_PUBLISHER_OFFLINE_OWNER_REHEARSAL.md` | NEW | `095fefe544e252867078622dd86ce7d8579a4bf346e10a4aa3c6a85519a38a55` | Owner-only isolated restore procedure; no customer bytes or execution. |
| 7 | `docs/EVIDENCE_PUBLISHER_PRIVATE_RETENTION_REVIEW.md` | M | `6af967ce6c0a7646bee7ab3122e1d1ebc54f22bf6df1bebb9a307e7755302720` | Recovery/private retention protocol and latest metadata-list/ingress/packaging caveats. |
| 8 | `docs/EVIDENCE_PUBLISHER_RELEASE_REVIEW.md` | NEW | `self-excluded (external index verification)` | Current blockers/results/manifest, full migration inventory and owner-ordered CI-only review plan. |
| 9 | `docs/EVIDENCE_PUBLISHER_V1.md` | M | `2f1b09f68d0e2cb2f4d170a754fa0454bf1d33f7e8953536fba1cdf8d09816d8` | Update runtime/version/cache references and link authoritative current QA. |
| 10 | `package-lock.json` | M | `a0c1667486634cb3f1f0dbeeccef5e94ac803c27943d4f0fd23b5a5224fc6661` | Lock patched compatible dependencies and scoped Workbox override. |
| 11 | `package.json` | M | `85a060b2f087434721b1147e762e04407baa1a7584f97bc897be65de2d309af1` | Pin Sharp patch, scope glob/minimatch override, include security/PWA verification. |
| 12 | `public/evidence-cache-cleanup.js` | NEW | `4e0350e3a89e6a583af4d58756a65d75ee8a5e32fbb46789cf40f4bc617efdb0` | Activation-time removal of private/signed entries from old browser cache only. |
| 13 | `scripts/evidence-cleanup.mjs` | NEW | `a0b3d392947b68ee8e8de2f99626807c33ecca6dec40889ce95e25ca31ddc680` | Disabled, exact-approved private object deletion with journal/proof/retry guards. |
| 14 | `scripts/evidence-draft-pr-core.mjs` | M | `0f55b1f9fcace6fd49334c10d0749be154a69a6eb4f24d43c14114a910a35ffc` | Privacy-safe text validation, snapshot rechecks and mandatory durable production executor. |
| 15 | `scripts/evidence-draft-pr.mjs` | M | `3e05d8e77d922fcc17819dc9e9321603f93cac7b9cc486a0acb1fc5fa6937714` | Attach persistent journal, validate optional recovery approval and sanitize CLI errors. |
| 16 | `scripts/evidence-durable-pr.mjs` | NEW | `c80e31971af518aa7b9fadb2e4755f1bb02064ccd0b758ae82628337924afc0a` | Persist Draft operation checkpoints; verify/adopt exact remote branch/PR; atomic receipt. |
| 17 | `scripts/evidence-image-sharp.mjs` | M | `02c5e9446746fe0f60fd9ec05681464457a74b29ce2e8d6efbe8afebce7643d0` | Bound Sharp processing, conditional private PUT/HEAD, durable staging and separate cleanup transport. |
| 18 | `scripts/evidence-local-bootstrap.mjs` | NEW | `bbe60cc72d30e12e522d73147639b70d11fdf35cb1343d40b2712c0e243442e7` | Fixed local Docker/project/container/port runner; fixture guards; ordered atomic schema application, no migration generation. |
| 19 | `scripts/evidence-migration-package.mjs` | NEW | `b05bc2ce54cfb24af1ad32cf371a3d37ef5a325ca836dde02251cbd85da6d333` | Review-only allowlisted two-schema artifact and complete production discovery inventory, no apply/network. |
| 20 | `scripts/evidence-offline-isolation.mjs` | NEW | `e235d492ad703cf7a86acccdc79a77f454c118c978d0e4e33c22a083e133fa73` | Fail-closed read-only Linux/internal-network isolation gate; no backup access. |
| 21 | `scripts/evidence-operation-journal.mjs` | NEW | `85ae7f9370a9c59b578419ff925a0aa1351766a1a1cc0e8607292d59bc30ab6b` | RPC adapter, tokens, uncertain reservation and digest/HEAD staging reconciliation. |
| 22 | `scripts/evidence-protected-env-preflight.mjs` | M | `4506aba6ec2c4c5c8e0d7e85caff9202f67eefc7c72c97652be0afc5a8a34a1f` | Require non-bypassable reviewers and prevent self-review. |
| 23 | `scripts/evidence-reconcile.mjs` | NEW | `e4d243beb42bcc09aeca851ab7a15d3302fa91f570fbaa7a4d7e8f2a547e66c1` | Owner-quiescent read-only remote reconciliation; no upload/PR creation/deletion. |
| 24 | `scripts/evidence-retention-review.mjs` | NEW | `6b31981bd26f6e94a8a2ce8b02b8aa4450f072524d3a855f17514b1b9c6a5485` | Offline inventory classifier that never authorizes deletion. |
| 25 | `scripts/seo-draft-pr-executor-adapters.mjs` | M | `6dabee6e750b49fcd6994baba4f3bcc123d028ecbeda3b419b37ea134765ea66` | Reject redirects and support deterministic timestamped Evidence commits. |
| 26 | `scripts/verify-evidence-dispatcher-contract.mjs` | NEW | `e00b5a4b38201f13e5285c9c25331af72d1bd180880020dba2b28b659985d105` | Local-only A/B functional and C unfinished-upload abuse contract tests, separate criteria, client cancellation/write/credential/retry checks; exits2 for unproved ingress bound. |
| 27 | `scripts/verify-evidence-hub-compat.mjs` | NEW | `d35f4ab54602bf0edb4b8f54227c19de9697c2d8e0b7b38eb397de82182619c6` | 20 real Local historical Hub Storage/Auth/Edge compatibility and revocation/expiry scenarios. |
| 28 | `scripts/verify-evidence-local-ingress.mjs` | NEW | `da3825eed9555e0a5556b10d8b5d8163ff890a2a8714addb219afcc09e002954` | Strict loopback gateway timing/fault regression suite; reports incomplete-body FAIL, bounded readiness and raw HTTP probe; no tokens/pixels logged. |
| 29 | `scripts/verify-evidence-pwa-output.mjs` | NEW | `18da2064313f8e48b04eda5e65408f8b49be77daef3f6ed8929ba1968ec73719` | Exercise generated service worker in inert VM; no real network/cache. |
| 30 | `scripts/verify-evidence-recovery-local.mjs` | NEW | `8716c39195c6e2877f7df704ee24e7eb2ba767dd11c702ec64d1faef1b03ca57` | Strict loopback-only standalone synthetic journal/access rehearsal. |
| 31 | `scripts/verify-evidence-supabase-local.mjs` | M | `769da973e8a0b6ce982668428cd28653746ecc866e4561db0dcd411baa329af8` | Real synthetic Local Auth/RLS/Storage/journal/two-site integration with mocked providers. |
| 32 | `src/components/TradeEvidenceCenter.tsx` | M | `164067804c2fbe85ee80a810b6bb8958e27029dbfc256f45ad9729e11a8c0064` | Short-lived stale-session-fenced preview refresh/cleanup; Owner-only export action matches server. |
| 33 | `src/lib/evidenceImageCachePolicy.ts` | NEW | `ab7410c41af22d6312a453d40b7c9b5cec9c459e3e17e1cdc443be980da12882` | Self-contained sensitive image route matcher serialized by Workbox. |
| 34 | `src/lib/evidencePrivateMediaClient.d.mts` | NEW | `7be85764aeb5390225cf82d1423cc94daefbda76335fdad18df2e3fa572a3d54` | Type declaration for browser private image POST client. |
| 35 | `src/lib/evidencePrivateMediaClient.mjs` | NEW | `613ada2b57f39cf4763a8ae990b089edc4992f9645c545e1331084b09438680e` | Authenticated no-store POST, timeout and bounded private image Blob. |
| 36 | `src/lib/tradeEvidence.ts` | M | `7c93202aa4c7156c8b4a0467025d0cf104dd2938c734ebdf048a3c3b2ad48e24` | Authenticated private preview/export client and short-lived Blob URL cleanup. |
| 37 | `supabase/config.toml` | M | `c467d6f6d449cfd6b3d39a38664e7c7165ed9c2881c18ad961bdb3baa2dffd64` | Explicit gateway JWT verification for private-media function. |
| 38 | `supabase/functions/_shared/evidence-private-media.mjs` | NEW | `8f3257726bd7a5f2c7712333f5ad7b621b89b01fb49ae388ab258efba3ba7ec8` | Owned cancellable timer lifecycle/manual parent propagation and independent15s Storage reader deadline; auth/consent/no-store unchanged. |
| 39 | `supabase/functions/evidence-private-media/index.ts` | NEW | `341d8e568c0727e3293fa32262fc78a2023084e78727626083c24a245862fff8` | Deno entry using server environment anon key/user auth, fixed Hub origin. |
| 40 | `supabase/migrations/20261126160233_evidence_recovery_local_qa.sql` | NEW | `2223148d1f98afbcab909f8b33788b43106112fa8d034c8cb5a82ce718095cd0` | Proposed PRODUCTION journal/locks/approvals/Storage/RPC schema; never auto-apply. |
| 41 | `tests/evidence-build-dependencies.test.mjs` | NEW | `af37e753cbebfcb9ce09854ebb8d49393a3df028a639518f35d18212e95054c0` | Real Workbox/glob/minimatch compatibility, cancellation and bounded pattern regressions. |
| 42 | `tests/evidence-draft-pr.test.mjs` | M | `8f6774bf3b75a410ec816fee4981f3a061467eee20b43719aac69114f6c0e249` | Synthetic privacy, consent/cancellation and uncertain Draft write regressions. |
| 43 | `tests/evidence-durable-recovery.test.mjs` | NEW | `befe73ca4acf0f2a41f9f023e645a218ebff7375fdac250efe54d185f13a83f3` | Synthetic uncertain HEAD/retry/cleanup permissions and deterministic commit regressions. |
| 44 | `tests/evidence-image-cache.test.mjs` | NEW | `6bb5c7d2c2df640649f5db393fde804a2907cf0b036bc445e6cae9f0ee71e598` | Synthetic route priority, no-store and old private cache cleanup tests. |
| 45 | `tests/evidence-image-sharp.test.mjs` | M | `bcc31366a03bb9078424af993a372ed859ec3fe756cb513c56cafe88248710ac` | Synthetic image bombs/metadata/SigV4 and stale authorization failure tests. |
| 46 | `tests/evidence-local-supabase/supabase/config.toml` | M | `0777683c0d56d5be2b7c9522515f53a2ddf81ed3d0cf44e7351eec849416ecb4` | Same explicit JWT gateway setting on disposable Local stack. |
| 47 | `tests/evidence-local-supabase/supabase/migrations/20261125000100_synthetic_fixture.sql` | D | `deleted (no blob)` | DELETE discovered test migration; replaced by guarded fixture source outside migration directories. |
| 48 | `tests/evidence-migration-packaging.test.mjs` | NEW | `1c057c492bfd0a15f4e8b4bd97fb2e2fdcd9a72b1cf158421edeec1e0b936965` | Production discovery exclusion, explicit JWT settings and exact artifact byte/content regressions. |
| 49 | `tests/evidence-offline-isolation.test.mjs` | NEW | `1ddd4eac102a7a9e1edfa4a5fc49912aff6d6a06e897a7d78c7fb2574e7967f5` | Synthetic isolation proof acceptance and unsafe platform/network rejection. |
| 50 | `tests/evidence-private-access.test.mjs` | NEW | `d4d1127301347bb89419280e62645063969b8fdacc98891b6b0d89427a71aff0` | Authorization/consent/no-store, actual streamed-input cancellation, overflow/MIME/error privacy regressions. |
| 51 | `tests/evidence-protected-env-preflight.test.mjs` | M | `30a865692eef81a91abbc7457a117a224e7fdd21d4e393fa307b1b5ce8d3edd2` | Reject self-review/admin bypass and unavailable Environment metadata. |
| 52 | `tests/evidence-retention-review.test.mjs` | NEW | `4e64e4a1a7970748d89f3e53285467f55b71d58030ac835df022f801eab9b622` | Read-only retention classification, shared references and incomplete inventory holds. |
| 53 | `tests/evidence-worker-security.test.mjs` | NEW | `0a4677b0592f19a696414d60913baf29eeffa1ef700a23f02b44b2b37cddaaae` | Worker role/consent/body bounds/conflict/cancel security regressions. |
| 54 | `tests/fixtures/evidence-hub-dependencies.sql` | NEW | `55bcd0448c3ed5fbc78692b293a71c0d628f74f7f86d94aba7bab2330471bf6f` | Guarded synthetic unrelated dependencies before replay of actual evidence policies/triggers. |
| 55 | `tests/fixtures/evidence-local-baseline.sql` | NEW | `0ce0fc325300181112c13f5680223758342ed51d652ba8ffcf19709d01824512` | Guarded synthetic server-facing schema source, outside migration discovery; local runner only. |
| 56 | `tests/fixtures/evidence-local-clock.sql` | NEW | `e02d0e41db5dc7744f894d7169563169fc4c7a373ea4823fbf8d4c751aa6a897` | Guarded test-only retention/policy clock source; outside discovery and review artifact; local runner only. |
| 57 | `tests/fixtures/evidence-private-media-diagnostic-entry.ts` | NEW | `f8bb0cd25754e5bd77e447e745180573e7692f781b9260eedc9d9a3f408884d5` | Guarded LOCAL_ONLY diagnostic entry source, real JWT/handler auth preserved, synthetic timing/stall/overflow/revocation faults; never production copy. |
| 58 | `tests/helpers/evidence-recovery-local.mjs` | NEW | `967e6a5d9d305b7dadeb3faa44a1323e398613b8dee8d83d0b9e4cadfa1f85aa` | 25 real Local SQL/Auth/Storage/Edge scenarios with only synthetic in-memory provider objects. |
| 59 | `tests/workflow-main-write-isolation.test.mjs` | NEW | `5b2519769cc043e4a7c964f474c760fd9c30633ebba6f2635f97e54514e7f9e8` | Two targeted workflow policy/credential tests, nine gate contexts; review-tool YAML parser supplied via YAML_MODULE_PATH; no application dependency. |
| 60 | `tsconfig.node.json` | M | `f63aee82e5ee083e27aeda557a05155835e66c0746303a00888204d7a26375fb` | Include cache-policy helper in Node/Vite typecheck. |
| 61 | `vite.config.ts` | M | `4a18ba4383cd9940deab38abf876981244c8c5cea1fe9ba05020c4f8fcf2b21a` | Prioritize private-image NetworkOnly/no-store and import old-cache cleanup. |
| 62 | `workers/evidence-publisher/index.mjs` | M | `ee3a22d686ae2f9c4a6371d56b19e08b17a7f94ada358227926cb21261727d9c` | Bound metadata requests, time out backend calls, handle enqueue conflicts and conditional cancellation. |

## Full root production migration discovery inventory

All paths below are relative to `supabase/migrations/`. These 142 entries are discoverable source, not authorized pending hosted changes. Test fixtures are absent.

```text
20260912000000_amphon_shop61_full_setup.sql
20260912090000_amphon_shop62_payment_e2e_gate.sql
20260912103000_amphon_shop62_token_hash_portability.sql
20260912113000_amphon_shop62_test_settings_completeness.sql
20260912123000_amphon_shop62_gateway_event_ambiguity_fix.sql
20260913090000_hub5_sales_channel_tracker.sql
20260913093000_hub5_event_action_id_fix.sql
20260913110000_hub6_sold_cleanup_tasks.sql
20260913210000_shop84_member_checkout_identity_bridge.sql
20260913230000_shop80_customer_identity_architecture.sql
20260913233000_shop801_customer_auth_boundary_hardening.sql
20260913234500_shop83_customer_address_book_invariants.sql
20260913235000_shop85_member_required_checkout.sql
20260913235900_shop85_member_required_checkout_activation.sql
20260913235930_shopseo4_retire_test_taxonomy.sql
20260914001000_shop86_member_order_history.sql
20260914133000_shop9_promptpay_activation.sql
20260914134000_shop9_promptpay_activation_pause_restore_cards.sql
20260914182500_shop9_shop62_member_checkout_test_bridge.sql
20260915115521_one1_integration_storage_foundation.sql
20260915125000_one2b_product_hub_shell_consumer.sql
20260915133000_one2c_product_hub_enrichment_workflow.sql
20260915133500_one2c_enrichment_hardening.sql
20260915172801_oneprod_hub_outbox_delivery.sql
20260915214500_one2d_legacy_mapping_consumer.sql
20260916104009_one3c_hub_stock_projection.sql
20260916104824_one3c_new_product_availability_init.sql
20260917125804_one4b_system_authority_checkout.sql
20260917130327_one4c_payment_sale_outbox.sql
20260917161000_one4d_production_activation_guard.sql
20260918161500_commerce_auto_publish.sql
20260918164200_commerce_auto_publish_cron.sql
20260919102500_merchant_auto_enable.sql
20260919121000_shopee_channel_runtime.sql
20260919193000_channel_architecture.sql
20260919204500_shopee_assisted_listing.sql
20260919211500_shopee_fixed_18_pricing.sql
20260923014050_shop_tier2_keyword_expansion.sql
20260923132339_shop_auto_seo_governance_taxonomy_hygiene.sql
20260924044732_shop_model_longtail_automation.sql
20260924145500_seo_demand_spec_governance.sql
20260924153000_gsc_action_engine.sql
20260924154500_gsc_action_ownership_override.sql
20260925003800_seo_ops_phase3_execute_measure_merchant_recovery_reviews.sql
20260926060000_seo_action_executor.sql
20260926161000_seo_auto_rollback_executor.sql
20260926162500_seo_auto_rollback_claim_hotfix.sql
20260926163000_seo_measurement_page_lock_budget.sql
20260926165000_stop_legacy_unaligned_measurements.sql
20260926171000_seo_learning_recovery_measurement.sql
20260926172000_seo_recovery_measurement_alias_hotfix.sql
20260926172500_seo_recovery_measurement_alias_hotfix_v2.sql
20260926173500_seo_prior_aware_action_selector.sql
20260926175500_seo_causal_volatility_guards.sql
20260926180000_seo_causal_policy_hotfix.sql
20260926182500_seo_control_tower_alerting.sql
20260928203000_central_channel_engine.sql
20260928211000_channel_credentials_vault.sql
20260928214500_channel_oauth_activation_guard.sql
20260929223000_facebook_production_post_ledger.sql
20260929224000_facebook_rotation_scheduler.sql
20260929231000_facebook_rotation_executor_guard.sql
20260929232000_facebook_rotation_staged_pages.sql
20260930152000_facebook_control_tower_weekly_scheduler.sql
20260930161000_facebook_weekly_scheduler_budget_guard.sql
20260930190000_facebook_learning_ledger_v1.sql
20260930191500_facebook_learning_guard_adaptive_selector.sql
20260930193000_facebook_engine_v1_closeout.sql
20261001113000_channel_engine_mapping_readiness_v1.sql
20261001122500_facebook_legacy_stock_backfill.sql
20261001154803_system_pricing_visibility.sql
20261001154931_one_managed_pricing_write_guard.sql
20261003112608_distribution_closeout.sql
20261003180500_facebook_false_skip_reconciliation.sql
20261003193000_distribution_closeout_finalize.sql
20261004111500_facebook_reach_first_rotation_v2.sql
20261004113500_facebook_new_arrival_lane.sql
20261004114000_facebook_rotation_six_slots_v3.sql
20261004114001_facebook_new_arrival_save_constraint_fix.sql
20261004182000_refund_resale_stock_projection.sql
20261006113839_forfeit_intake_cancel_sync.sql
20261008082714_operating_loop_security_integrity_outcomes_measurement.sql
20261008083304_recover_orphaned_one_product_targets.sql
20261008083536_activate_refund_resale_stock_projection.sql
20261008125009_close_rekeyed_sku_collision_incidents.sql
20261009004650_facebook_publish_idempotency_sold_sync.sql
20261009005039_facebook_history_recovery.sql
20261010050505_seo_network_monitoring.sql
20261010051207_seo_monitor_sitemap_discovery.sql
20261010051316_seo_network_dashboard_schema.sql
20261010090627_seo_gsc_direct_schema.sql
20261010095312_seo_gsc_direct_runtime.sql
20261010095405_seo_gsc_direct_schedule.sql
20261010105410_gsc_config_safeupdate_fix.sql
20261012031909_seo_growth_engine.sql
20261012040545_seo_evidence_attribution.sql
20261012042454_seo_evidence_integrity.sql
20261012045206_seo_content_revision_guard.sql
20261012050754_seo_approval_review_version.sql
20261013101016_hub_single_intake_listing.sql
20261013104131_seo_chatgpt_connector.sql
20261014152000_facebook_arrival_aware_daily_budget.sql
20261014154500_gsc_direct_action_measurement_bridge.sql
20261019124500_price_revision_facebook_sync.sql
20261019162000_facebook_price_existing_posts_reconciliation.sql
20261019171000_public_catalog_revisions_facebook_reconciliation.sql
20261019172500_one_system_catalog_consumer.sql
20261019174000_one_system_catalog_serial_guard.sql
20261025160235_facebook_page_cooldown.sql
20261026182000_facebook_safe_resume_after_meta_368.sql
20261027195500_facebook_sold_edit_circuit_breaker.sql
20261031210000_facebook_publish_only_pause_existing_post_edits.sql
20261101050500_fix_seo_lab_measurement_claim_ambiguity.sql
20261101052000_seo_phone_click_aggregate.sql
20261101053000_seo_phone_click_admin_read.sql
20261101113000_facebook_pacing_rolling_24h_publish_only.sql
20261101115500_facebook_rotation_expire_stale.sql
20261101120000_facebook_graph_usage_tracking.sql
20261101123500_facebook_learning_metrics_permission_guard.sql
20261102180000_facebook_six_posts_orphan_guard.sql
20261103173000_facebook_durable_publish_receipts.sql
20261103190000_facebook_unified_manual_queue_and_priority.sql
20261103191000_facebook_attention_states_and_daily_telemetry.sql
20261103192500_facebook_future_schedule_attention_fix.sql
20261116075954_amphon_seo_portfolio_control_v1.sql
20261116080057_amphon_seo_portfolio_gsc_date_key_fix.sql
20261116080533_amphon_seo_portfolio_gsc_granular_windows.sql
20261118135133_trade_evidence_library.sql
20261118135336_trade_evidence_anon_revoke.sql
20261118135723_trade_evidence_approval_edit_guard.sql
20261123094500_seo_source_change_requests.sql
20261123103000_seo_source_change_pr_runs.sql
20261123115749_seo_source_change_acl_hardening.sql
20261124030000_seo_release_branch_exceptions.sql
20261124035800_seo_portfolio_attribution_readiness.sql
20261124110000_trade_evidence_real_deal_economics.sql
20261124143000_seo_portfolio_rank_ledger.sql
20261124181500_seo_audit_improvement_center.sql
20261124190000_trade_evidence_page_source.sql
20261124210000_trade_evidence_image_sort_bigint.sql
20261124_evidence_publisher.sql
20261126160233_evidence_recovery_local_qa.sql
```

Final local inventory: **62 reviewed changed paths**. All staged for owner review in this pass; no commit/push/deploy. Index checks and final staging receipt below control the current state; older un-staged wording is historical.

## All 37 workflow event, permission and remote-effect audit

Source-only audit, 2026-11-27. All 37 parsed. `default` means effective repository/org permission policy is unverified. Contents:read is sufficient for source verification; remote API tokens/OIDC can authorize writes independently of that field. Job predicates remain additional gates, not replacements for branch/path filters. Routine checkout, cache, artifact and dependency network traffic is not classified as production deployment. No listed command was executed by this audit.

| Workflow | Exact trigger filters | Declared token permissions / job overrides | Remote operation assessment |
| --- | --- | --- | --- |
| [ai-buyer-line-learning-capture.yml](../.github/workflows/ai-buyer-line-learning-capture.yml) | `{"schedule":[{"cron":"20 17 * * *"}],"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Potential remote Supabase/LINE writes; collector in different checkout ref not locally verified; schedule/manual only. External Supabase/LINE secrets required. |
| [evidence-draft-pr-execute.yml](../.github/workflows/evidence-draft-pr-execute.yml) | `{"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read","actions":"read"},"jobs":{}}` | Manual private R2 + DB + GitHub Draft writes; protected evidence Environment, Supabase/R2 secrets and App contents/PR write token required. |
| [evidence-publisher-qa.yml](../.github/workflows/evidence-publisher-qa.yml) | `{"push":{"branches":["feature/evidence-publisher-gated-v1-20261124","codex/evidence-qa-safe-20261126"],"paths":["scripts/evidence-*.mjs","scripts/verify-evidence-*.mjs","tests/evidence-*.test.mjs","tests/fixtures/evidence-*.sql","supabase/config.toml","tests/helpers/evidence-recovery-local.mjs","supabase/migrations/20261126160233_evidence_recovery_local_qa.sql","supabase/functions/_shared/evidence-private-media.mjs","supabase/functions/evidence-private-media/**","src/lib/evidencePrivateMediaClient.*","src/lib/tradeEvidence.ts","src/components/TradeEvidenceCenter.tsx",".github/workflows/evidence-publisher-qa.yml","tests/evidence-local-supabase/**","scripts/verify-evidence-supabase-local.mjs","scripts/evidence-offline-isolation.mjs","tests/evidence-offline-isolation.test.mjs","tests/evidence-worker-security.test.mjs","tests/evidence-build-dependencies.test.mjs","tests/evidence-image-cache.test.mjs","src/lib/evidenceImageCachePolicy.ts","public/evidence-cache-cleanup.js","vite.config.ts","tsconfig.node.json","tests/evidence-retention-review.test.mjs","scripts/evidence-retention-review.mjs","scripts/verify-evidence-pwa-output.mjs","scripts/evidence-protected-env-preflight.mjs","tests/evidence-protected-env-preflight.test.mjs","supabase/migrations/20261124_evidence_publisher.sql","tests/sql/evidence-*.sql","scripts/evidence-image-sharp.mjs","tests/evidence-image-sharp.test.mjs",".github/workflows/evidence-draft-pr-execute.yml","docs/EVIDENCE_PUBLISHER_V1.md","docs/EVIDENCE_PUBLISHER_FREE_PLAN_BACKUP_AND_MIGRATION_RUNBOOK.md","scripts/evidence-production-readonly-preflight.sql","src/lib/evidenceSupabaseServerAuth.mjs","tests/evidence-supabase-server-auth.test.mjs","scripts/evidence-draft-pr.mjs","workers/evidence-publisher/**"]},"pull_request":{"paths":["scripts/evidence-*.mjs","scripts/verify-evidence-*.mjs","tests/evidence-*.test.mjs","tests/fixtures/evidence-*.sql","supabase/config.toml","tests/helpers/evidence-recovery-local.mjs","supabase/migrations/20261126160233_evidence_recovery_local_qa.sql","supabase/functions/_shared/evidence-private-media.mjs","supabase/functions/evidence-private-media/**","src/lib/evidencePrivateMediaClient.*","src/lib/tradeEvidence.ts","scripts/verify-evidence-pwa-output.mjs","tests/evidence-image-cache.test.mjs","src/lib/evidenceImageCachePolicy.ts","public/evidence-cache-cleanup.js","vite.config.ts","tsconfig.node.json","tests/evidence-build-dependencies.test.mjs","tests/evidence-retention-review.test.mjs","scripts/evidence-retention-review.mjs","scripts/evidence-offline-isolation.mjs","tests/evidence-offline-isolation.test.mjs","tests/evidence-worker-security.test.mjs","package-lock.json","src/lib/evidencePublisherPolicy.ts","src/components/EvidencePublisherPanel.tsx","src/components/TradeEvidenceCenter.tsx","workers/evidence-publisher/**","tests/evidence-publisher.test.mjs","supabase/migrations/20261124_evidence_publisher.sql","tests/sql/evidence-*.sql","tests/evidence-local-supabase/**","scripts/verify-evidence-supabase-local.mjs","scripts/evidence-protected-env-preflight.mjs","tests/evidence-protected-env-preflight.test.mjs","src/vite-env.d.ts","scripts/evidence-draft-pr*.mjs","scripts/evidence-image-sharp.mjs","src/lib/evidenceSupabaseServerAuth.mjs","tests/evidence-supabase-server-auth.test.mjs","tests/evidence-draft-pr.test.mjs","tests/evidence-image-sharp.test.mjs",".github/workflows/evidence-draft-pr-execute.yml","package.json",".github/workflows/evidence-publisher-qa.yml","docs/EVIDENCE_PUBLISHER_FREE_PLAN_BACKUP_AND_MIGRATION_RUNBOOK.md","scripts/evidence-production-readonly-preflight.sql"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{"local-supabase":{"contents":"read"},"hub-storage-compatibility":{"contents":"read"}}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [facebook-p0-reliability.yml](../.github/workflows/facebook-p0-reliability.yml) | `{"pull_request":{"paths":["workers/r2-upload/src/**","tests/facebook-*.test.mjs",".github/workflows/facebook-p0-reliability.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [hub-outbox-delivery.yml](../.github/workflows/hub-outbox-delivery.yml) | `{"push":{"branches":["main"],"paths":["workers/hub-outbox/**","scripts/verify-hub-outbox-delivery.mjs","package.json",".github/workflows/hub-outbox-delivery.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [hub-production-deploy.yml](../.github/workflows/hub-production-deploy.yml) | `{"push":{"branches":["main"],"paths":["src/**","public/**","index.html","package.json","package-lock.json","vite.config.ts","wrangler.jsonc",".github/workflows/hub-production-deploy.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare Hub production deploy + live HTTP smoke; CF deployment token required. |
| [hub-shop-ux.yml](../.github/workflows/hub-shop-ux.yml) | `{"pull_request":{"paths":["src/**","shop/**","workers/r2-upload/**","supabase/migrations/**","supabase/functions/seo-connector/**","tests/seo-connector.test.mjs","scripts/verify-ai-buyer-cost-history.test.mjs","scripts/verify-ai-buyer-cost-learning.test.mjs","scripts/verify-ai-buyer-structured-specs.test.mjs","scripts/verify-ai-buyer-cost-review.test.mjs","scripts/verify-ai-buyer-chat-price-control.test.mjs","scripts/verify-ai-buyer-notebook-coverage.test.mjs","scripts/verify-ai-buyer-notebook-coverage-prices.test.mjs","scripts/verify-ai-buyer-notebook-spec-verification.test.mjs","scripts/verify-pricebook-v28.test.mjs","scripts/verify-pricebook-v28-csv.test.mjs","scripts/verify-auto-publish.mjs","scripts/verify-merchant-shopee-foundation.mjs","scripts/verify-shopee-auto-publish.mjs","scripts/verify-channel-architecture.mjs","scripts/verify-shopee-assisted-listing.mjs","scripts/verify-shopee-assisted-listing.mjs","docs/shopee-integration-discovery.md","docs/channel-architecture.md",".github/workflows/store-worker-deploy.yml","scripts/verify-hub-publish-center-ux.mjs","scripts/verify-hub-ease.mjs","scripts/verify-gsc-action-engine.mjs","scripts/verify-seo-ops-phase3.mjs","scripts/verify-seo-action-executor.mjs",".github/workflows/hub-shop-ux.yml"]},"push":{"branches":["main"],"paths":["src/**","shop/**","workers/r2-upload/**","supabase/migrations/**","supabase/functions/seo-connector/**","tests/seo-connector.test.mjs","scripts/verify-auto-publish.mjs","scripts/verify-merchant-shopee-foundation.mjs","scripts/verify-shopee-auto-publish.mjs","scripts/verify-channel-architecture.mjs","docs/channel-architecture.md","scripts/verify-hub-publish-center-ux.mjs","scripts/verify-hub-ease.mjs",".github/workflows/hub-shop-ux.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one-bridge-deploy.yml](../.github/workflows/one-bridge-deploy.yml) | `{"pull_request":{"paths":["workers/one-bridge/**",".github/workflows/one-bridge-deploy.yml"]},"push":{"branches":["main"],"paths":["workers/one-bridge/**",".github/workflows/one-bridge-deploy.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare production bridge deploy/consumer activation outside PR; CF token required. |
| [one-product-flow-contract.yml](../.github/workflows/one-product-flow-contract.yml) | `{"pull_request":{"paths":["scripts/verify-one0.mjs","scripts/verify-one1.mjs","config/amphon-one-contract.json","config/amphon-one-product-flow.json","config/amphon-one3.json","docs/AMPHON_ONE_ARCHITECTURE_CONTRACT.md",".github/workflows/one-product-flow-contract.yml"]},"push":{"branches":["main"],"paths":["scripts/verify-one0.mjs","scripts/verify-one1.mjs","config/amphon-one-contract.json","config/amphon-one-product-flow.json","config/amphon-one3.json","docs/AMPHON_ONE_ARCHITECTURE_CONTRACT.md",".github/workflows/one-product-flow-contract.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one1-security-source.yml](../.github/workflows/one1-security-source.yml) | `{"push":{"branches":["main"],"paths":["workers/one-bridge/**","config/amphon-one-bridge.json","scripts/verify-one1-security.mjs","package.json","package-lock.json",".github/workflows/one1-security-source.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one2a-contract-source.yml](../.github/workflows/one2a-contract-source.yml) | `{"push":{"branches":["main"],"paths":["config/amphon-one-bridge.json","scripts/verify-one2a-contract.mjs","package.json",".github/workflows/one2a-contract-source.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one2b-source.yml](../.github/workflows/one2b-source.yml) | `{"push":{"branches":["main"],"paths":["workers/one-bridge/**","supabase/migrations/20260915125000_one2b_product_hub_shell_consumer.sql","config/amphon-one-bridge.json","scripts/verify-one2b.mjs","package.json","package-lock.json",".github/workflows/one2b-source.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one2c-source.yml](../.github/workflows/one2c-source.yml) | `{"push":{"branches":["main"],"paths":["config/amphon-one2c.json","supabase/migrations/20260915133000_one2c_product_hub_enrichment_workflow.sql","supabase/migrations/20260915133500_one2c_enrichment_hardening.sql","src/components/EnrichmentQueueDock.tsx","src/main.tsx","src/styles/one2cEnrichment.css","src/vite-env.d.ts",".env.example","docs/ONE_2C_PRODUCT_HUB_ENRICHMENT_WORKFLOW.md","scripts/verify-one2c.mjs","package.json","package-lock.json",".github/workflows/one2c-source.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one2d-production-acceptance.yml](../.github/workflows/one2d-production-acceptance.yml) | `{"push":{"branches":["main"],"paths":["config/amphon-one2d.json","config/amphon-one2d-production-acceptance.json","docs/ONE_2D_PRODUCTION_ACCEPTANCE.md","scripts/verify-one2d-production-acceptance.mjs","workers/one-bridge/wrangler.jsonc","package.json",".github/workflows/one2d-production-acceptance.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one2d-source.yml](../.github/workflows/one2d-source.yml) | `{"push":{"branches":["main"],"paths":["config/amphon-one2d.json","config/amphon-one-bridge.json","supabase/migrations/20260915214500_one2d_legacy_mapping_consumer.sql","workers/one-bridge/src/index.ts","workers/one-bridge/src/one2b-entry.ts","workers/one-bridge/wrangler.jsonc","scripts/verify-one1-security.mjs","scripts/verify-one2b.mjs","scripts/verify-one2d.mjs","package.json",".github/workflows/one2d-source.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one3a.yml](../.github/workflows/one3a.yml) | `{"push":{"paths":["config/amphon-one3.json","config/amphon-one-product-flow.json","docs/ONE_3_UNIFIED_SALE_STOCK_STATE.md","scripts/verify-one3a.mjs","src/lib/backend.ts","package.json",".github/workflows/one3a.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one3c.yml](../.github/workflows/one3c.yml) | `{"push":{"paths":["config/amphon-one3.json","supabase/migrations/20260916104009_one3c_hub_stock_projection.sql","supabase/migrations/20260916104824_one3c_new_product_availability_init.sql","workers/one-bridge/src/one2b-entry.ts","workers/one-bridge/wrangler.jsonc","scripts/verify-one3c.mjs","scripts/deploy-one3c-production.mjs","package.json",".github/workflows/one3c.yml"]},"pull_request":{"paths":["config/amphon-one3.json","supabase/migrations/20260916104009_one3c_hub_stock_projection.sql","supabase/migrations/20260916104824_one3c_new_product_availability_init.sql","workers/one-bridge/src/one2b-entry.ts","workers/one-bridge/wrangler.jsonc","scripts/verify-one3c.mjs","scripts/deploy-one3c-production.mjs","package.json",".github/workflows/one3c.yml"]}}` | `{"workflow":"default","jobs":{}}` | Production bridge deploy only push main; other branches/PR verify/runner-smoke only. CF token required by deploy. |
| [one4a.yml](../.github/workflows/one4a.yml) | `{"push":{"paths":["config/amphon-one4.json","docs/ONE_4_SHOP_RESERVATION_CHECKOUT.md","scripts/verify-one4a.mjs","workers/r2-upload/src/index.ts","package.json",".github/workflows/one4a.yml"]},"pull_request":{"paths":["config/amphon-one4.json","docs/ONE_4_SHOP_RESERVATION_CHECKOUT.md","scripts/verify-one4a.mjs","workers/r2-upload/src/index.ts","package.json",".github/workflows/one4a.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one4b-apply-r2-patch.yml](../.github/workflows/one4b-apply-r2-patch.yml) | `{"push":{"branches":["main"],"paths":["scripts/apply-one4b-r2-patch.mjs",".github/workflows/one4b-apply-r2-patch.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{"apply":{"contents":"write"}}}` | Main write only canonical main push plus explicit owner opt-in; contents:write job + step token. Default disabled; respects protection. |
| [one4b.yml](../.github/workflows/one4b.yml) | `{"push":{"paths":["config/amphon-one4.json","supabase/migrations/20260916235000_one4b_system_authority_checkout.sql","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/src/index.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4b.mjs","package.json",".github/workflows/one4b.yml"]},"pull_request":{"paths":["config/amphon-one4.json","supabase/migrations/20260916235000_one4b_system_authority_checkout.sql","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/src/index.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4b.mjs","package.json",".github/workflows/one4b.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one4c.yml](../.github/workflows/one4c.yml) | `{"push":{"branches":["main","one4c-shop-payment-sale-runtime"],"paths":["supabase/migrations/20260917125804_one4b_system_authority_checkout.sql","supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql","workers/r2-upload/package.json","workers/r2-upload/package-lock.json","workers/r2-upload/tsconfig.json","workers/r2-upload/src/one4c-entry.ts","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4c.mjs","scripts/verify-one4b.mjs","package.json",".github/workflows/one4c.yml"]},"pull_request":{"paths":["supabase/migrations/20260917125804_one4b_system_authority_checkout.sql","supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql","workers/r2-upload/package.json","workers/r2-upload/package-lock.json","workers/r2-upload/tsconfig.json","workers/r2-upload/src/one4c-entry.ts","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4c.mjs","scripts/verify-one4b.mjs","package.json",".github/workflows/one4c.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one4d.yml](../.github/workflows/one4d.yml) | `{"push":{"branches":["main","one4d-production-activation-e2e"],"paths":["supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql","supabase/migrations/20260917161000_one4d_production_activation_guard.sql","config/one4d-production-acceptance.json","workers/r2-upload/package.json","workers/r2-upload/package-lock.json","workers/r2-upload/tsconfig.json","workers/r2-upload/src/one4c-entry.ts","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4c.mjs","scripts/verify-one4d.mjs","package.json",".github/workflows/one4d.yml"]},"pull_request":{"paths":["supabase/migrations/20260917130327_one4c_payment_sale_outbox.sql","supabase/migrations/20260917161000_one4d_production_activation_guard.sql","config/one4d-production-acceptance.json","workers/r2-upload/package.json","workers/r2-upload/package-lock.json","workers/r2-upload/tsconfig.json","workers/r2-upload/src/one4c-entry.ts","workers/r2-upload/src/one4-system-stock.ts","workers/r2-upload/wrangler.jsonc","scripts/verify-one4c.mjs","scripts/verify-one4d.mjs","package.json",".github/workflows/one4d.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [one4e.yml](../.github/workflows/one4e.yml) | `{"pull_request":{"paths":["config/one4e-production-observation.json","scripts/inspect-one4e-hub-health.mjs","scripts/verify-one4e.mjs","docs/ONE_4E_SHOP_MONITORING.md","workers/r2-upload/wrangler.jsonc","package.json",".github/workflows/one4e.yml"]},"push":{"branches":["main"],"paths":["config/one4e-production-observation.json","scripts/inspect-one4e-hub-health.mjs","scripts/verify-one4e.mjs","docs/ONE_4E_SHOP_MONITORING.md","workers/r2-upload/wrangler.jsonc","package.json",".github/workflows/one4e.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":"default","jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [seo-ai-development-p0.yml](../.github/workflows/seo-ai-development-p0.yml) | `{"pull_request":{"paths":["supabase/functions/seo-connector/core.ts","supabase/functions/seo-connector/index.ts","supabase/functions/seo-connector/developmentStatus.ts","supabase/functions/seo-connector/sourceChangeGuard.ts","supabase/migrations/20261123094500_seo_source_change_requests.sql","src/components/SeoPortfolioDashboard.tsx","src/components/SeoControlTower.tsx","src/components/SeoDevelopmentCenter.tsx","src/components/SeoSourceChangeQueue.tsx","src/styles/seoDevelopmentCenter.css","scripts/verify-seo-portfolio-mcp.mjs","tests/seo-connector.test.mjs","tests/seo-development-status.test.mjs","tests/seo-source-change.test.mjs","tests/seo-draft-pr-executor.test.mjs","tests/seo-draft-pr-adapters.test.mjs","tests/seo-draft-pr-reconcile.test.mjs","tests/seo-release-verification.test.mjs","tests/seo-release-comparison.test.mjs","tests/seo-production-evidence.test.mjs","scripts/seo-production-evidence.mjs","scripts/seo-production-evidence-core.mjs","scripts/seo-production-http-qa.mjs","tests/seo-production-http-qa.test.mjs",".github/workflows/seo-production-http-qa-readonly.yml","docs/SEO_LIVE_HTTP_QA_P9.md",".github/workflows/seo-production-evidence-readonly.yml","supabase/functions/seo-connector/releaseComparison.ts","supabase/functions/seo-connector/releaseMeasurement.ts","src/components/SeoReleaseVerificationPanel.tsx","supabase/functions/seo-gsc/index.ts","scripts/seo-draft-pr-reconcile.mjs",".github/workflows/seo-draft-pr-reconcile.yml","scripts/seo-draft-pr-executor-core.mjs","scripts/seo-draft-pr-executor-adapters.mjs","scripts/seo-draft-pr-executor.mjs","scripts/seo-draft-pr-target.mjs",".github/workflows/seo-draft-pr-execute.yml","supabase/migrations/20261123103000_seo_source_change_pr_runs.sql","supabase/migrations/20261124030000_seo_release_branch_exceptions.sql","supabase/migrations/20261124035800_seo_portfolio_attribution_readiness.sql","tests/fixtures/seo_portfolio_attribution_readiness_contract.sql","tests/fixtures/seo_release_branch_exception_contract.sql","tests/fixtures/seo_source_change_postgres_contract.sql","package.json",".github/workflows/seo-ai-development-p0.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [seo-approved-webuy-20261013.yml](../.github/workflows/seo-approved-webuy-20261013.yml) | `{"push":{"branches":["main"],"paths":[".github/workflows/seo-approved-webuy-20261013.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare WEBUY deploy of fixed revision; CF token required. |
| [seo-audit-center-qa.yml](../.github/workflows/seo-audit-center-qa.yml) | `{"pull_request":{"branches":["main"],"paths":["src/components/SeoAuditCenter.tsx","src/components/SeoControlTower.tsx","src/lib/seoAuditCenter.ts","src/styles/seoAuditCenter.css","supabase/migrations/20261124181500_seo_audit_improvement_center.sql","tests/seo-audit-center.test.mjs",".github/workflows/seo-audit-center-qa.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [seo-draft-pr-execute.yml](../.github/workflows/seo-draft-pr-execute.yml) | `{"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Manual GitHub Draft + DB writes; protected Environment + Supabase/App credentials (contents/PR write). |
| [seo-draft-pr-reconcile.yml](../.github/workflows/seo-draft-pr-reconcile.yml) | `{"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Manual optional DB receipt write when write_audit_receipt=true; protected Environment + Supabase secret; scoped App contents/PR read. |
| [seo-evidence-render.yml](../.github/workflows/seo-evidence-render.yml) | `{"push":{"branches":["main"],"paths":["scripts/seo-evidence-render.mjs",".github/workflows/seo-evidence-render.yml","docs/seo-content-releases/**"]},"schedule":[{"cron":"*/10 * * * *"}],"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read","id-token":"write"},"jobs":{}}` | Remote ledger claim/finish/fail POST writes + public page reads; id-token:write and external OIDC trust required. |
| [seo-production-evidence-readonly.yml](../.github/workflows/seo-production-evidence-readonly.yml) | `{"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Manual protected live read collection (no ledger/deploy authorization); credentials/environment gate still required. |
| [seo-production-http-qa-readonly.yml](../.github/workflows/seo-production-http-qa-readonly.yml) | `{"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Manual protected live HTTP/TLS reads; no publication/ledger authorization. |
| [seo-rank-ledger-qa.yml](../.github/workflows/seo-rank-ledger-qa.yml) | `{"pull_request":{"branches":["main"],"paths":["src/lib/seoRankLedger.ts","src/components/SeoPortfolioDashboard.tsx","supabase/functions/seo-gsc/**","supabase/migrations/20261124143000_seo_portfolio_rank_ledger.sql","tests/seo-rank-ledger.test.mjs",".github/workflows/seo-rank-ledger-qa.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [seo-stock-lot-20261017.yml](../.github/workflows/seo-stock-lot-20261017.yml) | `{"push":{"branches":["main"],"paths":[".github/workflows/seo-stock-lot-20261017.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare amphontd deploy of fixed revision; CF token required. |
| [shop-iphone-trust-qa.yml](../.github/workflows/shop-iphone-trust-qa.yml) | `{"pull_request":{"paths":["shop/src/config/catalog.ts","shop/src/config/category-inspection-notes.ts","shop/src/components/StockComparison.astro","shop/scripts/verify-core-update-iphone-trust.mjs",".github/workflows/shop-iphone-trust-qa.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |
| [shop-production-deploy.yml](../.github/workflows/shop-production-deploy.yml) | `{"push":{"branches":["main"],"paths":["shop/**",".github/workflows/shop-production-deploy.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare Shop production deployment/live smoke; CF token required. |
| [store-worker-deploy.yml](../.github/workflows/store-worker-deploy.yml) | `{"push":{"branches":["main"],"paths":["workers/r2-upload/**",".github/workflows/store-worker-deploy.yml"]},"workflow_dispatch":"manual (inputs in source)"}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Cloudflare deploy and optional Shopee secret put writes; CF token + optional Shopee secrets required. |
| [trade-evidence-economics-qa.yml](../.github/workflows/trade-evidence-economics-qa.yml) | `{"pull_request":{"branches":["main"],"paths":["src/components/TradeEvidenceCenter.tsx","src/lib/tradeEvidence*.ts","src/styles/tradeEvidence.css","supabase/migrations/*trade_evidence_real_deal_economics.sql","tests/trade-evidence-economics.test.mjs","tests/fixtures/trade_evidence_real_deal_economics_contract.sql",".github/workflows/trade-evidence-economics-qa.yml"]}}` | `{"workflow":{"contents":"read"},"jobs":{}}` | Verification/build/synthetic fixture or explicit dry-run only; no declared production write transport. Review dependency/token defaults separately. |

### Exact job predicates, Environment gates and referenced secrets

Names only, never secret values. Inputs/defaults for manual workflows remain in linked source.

- **ai-buyer-line-learning-capture.yml**: jobs `{"capture":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["SUPABASE_SECRET_KEY","LINE_CHANNEL_ACCESS_TOKEN"]`.
- **evidence-draft-pr-execute.yml**: jobs `{"create-draft":{"if":"github.repository == 'noteroru2/amphon-product-hub-shop'","environment":"evidence-draft-pr-protected","step_conditions":[]}}`; secret references `["EVIDENCE_DRAFT_PR_ENVIRONMENT_APPROVED","AMPHON_SEO_SUPABASE_URL","AMPHON_EVIDENCE_SUPABASE_SECRET_KEY","AMPHON_SEO_GITHUB_APP_ID","AMPHON_SEO_GITHUB_APP_PRIVATE_KEY","AMPHON_CLOUDFLARE_ACCOUNT_ID","AMPHON_R2_ACCESS_KEY_ID","AMPHON_R2_SECRET_ACCESS_KEY"]`.
- **evidence-publisher-qa.yml**: jobs `{"dry-run":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"ephemeral-sql":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"local-supabase":{"if":"no extra job predicate","environment":"none","step_conditions":[{"name":"Tear down and delete isolated local database","if":"always()"}]},"hub-storage-compatibility":{"if":"no extra job predicate","environment":"none","step_conditions":[{"name":"Tear down and delete isolated local database","if":"always()"}]}}`; secret references `[]`.
- **facebook-p0-reliability.yml**: jobs `{"regression":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **hub-outbox-delivery.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **hub-production-deploy.yml**: jobs `{"deploy":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **hub-shop-ux.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one-bridge-deploy.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"deploy":{"if":"github.event_name != 'pull_request'","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **one-product-flow-contract.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one1-security-source.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one2a-contract-source.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one2b-source.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one2c-source.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one2d-production-acceptance.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one2d-source.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one3a.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one3c.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"windows-runner-smoke":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"deploy-production":{"if":"github.event_name == 'push' && github.ref == 'refs/heads/main'","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **one4a.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one4b-apply-r2-patch.yml**: jobs `{"apply":{"if":"github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'noteroru2/amphon-product-hub-shop' && vars.ONE4B_PATCH_MAIN_WRITE_APPROVED == 'YES_OWNER_ENABLED'","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one4b.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one4c.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one4d.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **one4e.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **seo-ai-development-p0.yml**: jobs `{"check":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"postgres-contract":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **seo-approved-webuy-20261013.yml**: jobs `{"deploy":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **seo-audit-center-qa.yml**: jobs `{"integration-and-access":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **seo-draft-pr-execute.yml**: jobs `{"draft-pr":{"if":"github.repository == 'noteroru2/amphon-product-hub-shop'","environment":"seo-draft-pr-protected","step_conditions":[]}}`; secret references `["SEO_DRAFT_PR_ENVIRONMENT_APPROVED","AMPHON_SEO_SUPABASE_URL","AMPHON_SEO_SERVICE_ROLE_KEY","AMPHON_SEO_GITHUB_APP_ID","AMPHON_SEO_GITHUB_APP_PRIVATE_KEY"]`.
- **seo-draft-pr-reconcile.yml**: jobs `{"reconcile":{"if":"github.repository == 'noteroru2/amphon-product-hub-shop'","environment":"seo-draft-pr-protected","step_conditions":[{"name":"Record independently verified original Draft PR receipt only","if":"inputs.write_audit_receipt"}]}}`; secret references `["SEO_DRAFT_PR_ENVIRONMENT_APPROVED","AMPHON_SEO_SUPABASE_URL","AMPHON_SEO_SERVICE_ROLE_KEY","AMPHON_SEO_GITHUB_APP_ID","AMPHON_SEO_GITHUB_APP_PRIVATE_KEY"]`.
- **seo-evidence-render.yml**: jobs `{"capture":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **seo-production-evidence-readonly.yml**: jobs `{"discovery":{"if":"github.repository == 'noteroru2/amphon-product-hub-shop'","environment":"seo-production-evidence-protected","step_conditions":[]}}`; secret references `["SEO_EVIDENCE_ENVIRONMENT_APPROVED","AMPHON_SEO_SUPABASE_URL","AMPHON_SEO_SERVICE_ROLE_KEY","AMPHON_CLOUDFLARE_ACCOUNT_ID","AMPHON_CLOUDFLARE_API_TOKEN","AMPHON_SEO_GITHUB_READ_TOKEN"]`.
- **seo-production-http-qa-readonly.yml**: jobs `{"verify":{"if":"github.repository == 'noteroru2/amphon-product-hub-shop'","environment":"seo-production-evidence-protected","step_conditions":[{"name":"Save redacted public-only evidence","if":"always()"}]}}`; secret references `["SEO_EVIDENCE_ENVIRONMENT_APPROVED"]`.
- **seo-rank-ledger-qa.yml**: jobs `{"verify":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **seo-stock-lot-20261017.yml**: jobs `{"deploy":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **shop-iphone-trust-qa.yml**: jobs `{"iphone-trust":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.
- **shop-production-deploy.yml**: jobs `{"deploy":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN"]`.
- **store-worker-deploy.yml**: jobs `{"deploy":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `["CLOUDFLARE_API_TOKEN","SHOPEE_PARTNER_ID","SHOPEE_PARTNER_KEY"]`.
- **trade-evidence-economics-qa.yml**: jobs `{"web-qa":{"if":"no extra job predicate","environment":"none","step_conditions":[]},"postgres-qa":{"if":"no extra job predicate","environment":"none","step_conditions":[]}}`; secret references `[]`.

## Final staging receipt ? owner review stop

- Explicit manifest matched all62 staged source paths (61 present blobs, one old fixture path removed). Git renders61 diff entries because it detects the baseline move as a rename.
- Staged-blob redacted credential scan:61 files, zero findings; no binary/media/backup/log/env or fixture-only migration contents staged. This bounded pattern/manual review is not certification against every unknown secret format.
- `git diff --cached --check`: PASS, exit0. `git diff --cached --stat` and `git diff --cached --name-only --no-renames` were displayed for owner review; complete purpose manifest remains above.
- Only2 targeted workflow tests and37 YAML parses executed this pass; prior76 application tests/dispatcher investigation were not rerun.
- All local logs, including `.evidence-gates-review-content.log`, remain ignored and outside index. Test fixture sources outside migration discovery are intentional reviewed inputs; the old discovered migration is removed.
- No unstaged source changes, no commit and no remote operation. HEAD remains407a314533e5d206f29d78b02c75aa58d9637e26 on codex/evidence-qa-safe-20261126.
- **STOPPED FOR OWNER REVIEW BEFORE LOCAL COMMIT. PUSH HOLD; Production NO-GO.**

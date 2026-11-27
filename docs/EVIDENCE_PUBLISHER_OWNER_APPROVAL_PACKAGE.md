# AMPHON Evidence Publisher — security-first owner approval package

Prepared 2026-11-27, Asia/Bangkok. **PROPOSAL ONLY: QA PUSH HOLD / PR HOLD /
PRODUCTION NO-GO.** No remote settings, workflow execution or production changes
are authorized by this document. A configuration proposal is not an applied
control or an approval to merge.

Local repository: `noteroru2/amphon-product-hub-shop`; branch:
`codex/evidence-qa-safe-20261126`; existing commit:
`46bc4ec1d5d60af8111bd76ea41b6d8229c62f97`. Remote main read this turn remains
`79778626a58fd9077ca81f4655c0a19fe9896328`, `protected=false`.
The [release review](EVIDENCE_PUBLISHER_RELEASE_REVIEW.md) contains the prior full
read-only account audit. Its uncommitted findings are preserved, not replaced by
this proposal. Previously denied Apps/Vercel APIs were not retried this turn.

## 1. Proposed main branch Ruleset

Readiness: **proposal prepared; NOT APPLIED; independent reviewer prerequisite
BLOCKED**. A complete direct-collaborator GET returned one collaborator, the
owner, and zero non-owner collaborators with write/maintain/admin permission.
No existing independent PR approver has been verified. The owner must nominate
an independent human and separately authorize suitable repository access before
relying on approvals. Do not fabricate a reviewer, add a bypass, or weaken the
approval rule to make a single-person merge possible.

Proposed ruleset name: `AMPHON main independent-review protection`. This exact
JSON is a review artifact, not an executed request. Its endpoint, if separately
authorized later, is the repository rulesets endpoint. Intended enforcement is
`active`, not `evaluate`; no setting has been sent to GitHub.

```json
{
  "name": "AMPHON main independent-review protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true
      }
    }
  ]
}
```

This requires a PR, one approval, reapproval after reviewable changes, approval
independent of the latest pusher, and resolved review conversations. The empty
bypass list includes no owner/admin role, App, bot or deploy key. Deletion and
force pushes are prohibited. No unverified CODEOWNERS roster or new merge-method
restriction is introduced. Repository admins can still edit settings; an empty
bypass list is not protection against an administrator changing the ruleset.
See [GitHub ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
and [ruleset REST fields](https://docs.github.com/en/rest/repos/rules).

### Required status checks: deliberately no unverified requirement

Actual read: main check-runs **200**, 13 results, no next page. Ten successful
`capture` runs and one each of `Workers Builds: amphon-product-hub`, `deploy` and
`verify` were returned. GitHub Actions producer App ID is **15368**; Cloudflare
Workers and Pages producer App ID is **85455**. Combined commit-status GET was
**200**, zero statuses; its aggregate `pending` is not an actual named pending
check. These check records also confirm Cloudflare's historical involvement,
not the complete installed-App permission inventory.

| Existing context | Add to this ruleset now? | Reason |
| --- | --- | --- |
| `capture` | No | Scheduled/render capture can perform remote ledger writes and is not a universal premerge security check. |
| `Workers Builds: amphon-product-hub` | No | External build/version-upload activity; requiring it would couple merge eligibility to a remote write. QA previews are disabled. |
| `deploy` | No | Production deployment is not an acceptable premerge prerequisite. |
| `verify` | No | Reused across multiple workflows; no unique, always-selected PR producer is verified for the one-file security patch. |
| New Evidence QA job names | No | Exist locally but have not run on GitHub at the proposed SHA; path filtering also prevents universal applicability. |

Therefore the initial proposal contains **no `required_status_checks` rule** and
does not invent a context. This is an explicit CI coverage gap for owner review,
not a claim that checks are enforced. A one-file ONE-4B workflow-only PR currently
matches no PR CI workflow in the static audit below. If the owner requires CI as
a merge prerequisite, keep the security merge on HOLD until a separately reviewed
unique, synthetic, non-deploying PR check exists and has an actual successful run
on the candidate head. Then add its exact context and verified producer App ID,
with branch-up-to-date enforcement, after checking path/event coverage. No new
workflow or hosted run is authorized here. Path-skipped required workflows can
leave checks pending; see [GitHub required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

Owner dashboard proposal: repository **Settings → Rules → Rulesets → New branch
ruleset**; use the values above, exact branch `main`, empty bypass list. Do not
save/activate under the current authorization. After a separate approval and
application, verify the active ruleset detail and effective rules for `main`
through read-only GETs; inspect bypass actors with suitable permission. Do not
test enforcement by pushing, deleting, force pushing or attempting a merge.

## 2. Proposed protected Environment changes

Targets are exactly `evidence-draft-pr-protected` and
`seo-production-evidence-protected`. Both detail GETs succeeded again this turn.
Each currently has one User reviewer, `noteroru2` (ID **241333319**),
`prevent_self_review=false`, and `can_admins_bypass=false`. Prior successful
branch-policy reads allow only `main` with policy type `branch`.

| Field / control | Exact proposed state for both Environments |
| --- | --- |
| Required reviewers | Owner-nominated independent human reviewer(s), verified repository access, up to GitHub's supported roster size. Resolve actual IDs before preparing any apply payload. No bot or invented ID. |
| `prevent_self_review` | **true** |
| `can_admins_bypass` | **false**, retain |
| `deployment_branch_policy.protected_branches` | **false**, retain explicit selected-branch mode |
| `deployment_branch_policy.custom_branch_policies` | **true** |
| Allowed branch policy | Exactly one entry: name **`main`**, type **`branch`** |
| Tag/QA/feature patterns | None; do not add `*`, `codex/**`, `refs/pull/**`, or a tag named main |
| Activation secrets, deployment secrets, variables | No creation, rotation, value read or enablement in this package |
| Publisher/cleanup/workflow activation | No dispatch, approval of a queued job, feature-flag change or workflow enablement |

**Reviewer identity is unresolved**, so an executable Environment update payload
is intentionally not supplied. Keeping the sole owner reviewer while enabling
self-review prevention would block an owner-initiated run; do not describe that
as a completed independent-review setup. One qualified additional collaborator
with write access could satisfy both PR and Environment review eligibility; an
Environment-only reviewer requires at least read access. Any access grant needs
its own owner approval. Do not grant admin or bypass permission for convenience.

GitHub requires only one listed Environment reviewer to approve; listing two
people does not impose two approvals. Prevent-self-review concerns the workflow
initiator; independence from the code author, latest pusher and publication
requester must also be checked by the human reviewer. See
[GitHub Environment review semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

Owner dashboard proposal: repository **Settings → Environments → each exact name**;
review the nominated roster, enable **Prevent self-review**, retain disabled admin
bypass, and retain **Selected branches and tags** with a branch-only `main` rule.
Do not substitute “Protected branches only”: GitHub documents that mode allowing
all branches if no branch protections exist. Do not save changes yet.
See [Environment management](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

The Evidence executor preflight already rejects self-review allowance/admin
bypass. The Worker dispatch flag stays false and no activation sentinel is
changed. Changing reviewer policy does not itself dispatch a workflow or enable
Publisher. It can release a different already-pending job if its policy becomes
satisfied: before applying settings later, inspect queued/waiting jobs and obtain
separate approval to deal with any pending privileged execution. Do not approve
or cancel such jobs as part of this read-only package.

## 3. Minimal security-only ONE-4B PR plan

**PLAN ONLY; creation, push and merge HOLD.** Do not cherry-pick or merge the
62-path Evidence commit onto main to fix one workflow. Prepare a separate branch
from the then-current, owner-reviewed main only after separate authorization.
Proposed branch: `security/one4b-main-write-isolation`; proposed PR title:
`fix(ci): gate ONE-4B main writes behind owner opt-in`.

Exact future security-only source manifest: **one file**,
`.github/workflows/one4b-apply-r2-patch.yml`. Reuse its already-reviewed Git blob
from local commit `46bc4ec1d5d60af8111bd76ea41b6d8229c62f97`, whose content SHA-256
is **`6c74c78f9c5073069fc02ebb10c592c1b73d252c509cef1bb70e71578e53b30e`**.
Current remote old workflow Git blob ID is
`b222f07fba25e6a014cd32d7e640aad932c2e7c0` (a Git object ID, not SHA-256).
No script, application, package, migration, Worker source/config, tests or
Publisher workflow is part of that future one-file change. This package itself
does not create that branch or change any workflow file.

The reviewed replacement limits push triggers to main and independently checks
canonical repository, main push and exact Owner Opt-in sentinel. Workflow token
defaults read; the gated apply job has job-wide contents:write. It checks out the
event SHA without persisted credentials and rechecks context/HEAD before its
normal fast-forward push. Explicit token env placement only in the final step
does not provide step-level permission isolation. Deterministic patch generation
and dry-run remain inside the gated job. No new dispatch trigger is added.

Under the proposed PR-required ruleset with no bypass, the direct automated main
push is intentionally blocked even if somebody later enables the opt-in. Keep
that opt-in absent. Do not add a bot bypass to restore the old operational flow;
a future reviewed PR-generation design would need separate work and approval.

### What a one-file merge can select

Executed a static branch/path analysis over the 37 committed workflows. For a
diff containing only that workflow, **one push event matches**: the replacement
ONE-4B workflow itself. Its apply job is skipped while the opt-in is absent.
**Zero pull-request events match** this one-file diff. No workflow was executed.
The previous account audit found the opt-in variable absent; recheck absence
immediately before any future merge rather than assuming it remains absent.

| Known deployment path | One-file scope assessment |
| --- | --- |
| GitHub Hub/Shop/Store/Bridge deploy workflows | Their branch/path filters do not match this sole workflow path. |
| ONE-3C production deploy | Its source paths do not match this sole workflow path. |
| Cloudflare Hub Builds | Previously read watch paths exclude `.github/workflows/**`; main-only branch still matches main, so verify unchanged watch paths and the complete event diff before relying on the exclusion. |
| Cloudflare Shop Builds | Previously read watch paths are `shop/**`; sole workflow path does not match. |
| GitHub Apps / Vercel / other hook consumers | **UNKNOWN**; inventories are incomplete. They may react regardless of Actions path filters or a read-only workflow token. |

This proves a bounded source-level path assessment, **not that an eventual merge
cannot deploy**. The full no-deploy merge claim is **NOT VERIFIED / MERGE HOLD**.
Before any merge, close App/hook inventory gaps, verify exact head/base/diff and
all current trigger/opt-in settings, and inspect waiting privileged jobs. If any
consumer can still write/deploy on this event or cannot be inspected, require a
separate owner-authorized and verified deployment freeze covering that consumer;
do not merge to test its behavior. Do not rely on `[skip ci]`, Draft status, a
disabled Publisher flag, or an unexecuted plan as a universal deploy interlock.
See [Cloudflare watch-path semantics](https://developers.cloudflare.com/workers/ci-cd/builds/build-watch-paths/).

## 4. Owner dashboard inspection: Apps and hooks

These instructions authorize inspection only. Do not use Save, Install, Approve
permissions, Generate key, Suspend, Remove, Test, Redeliver, Create hook or Deploy.
Never click a deploy-hook URL; invoking it may start deployment. Record metadata
only; mask destination URLs, query strings, signing secrets, tokens and keys.

### GitHub Apps

API limitation: account installation inventory returned 403; the connector's one
accessible installation is not a complete installed-App inventory. Repository
webhooks were successfully empty, which does not cover App webhooks.

1. GitHub personal **Settings → Applications → Installed GitHub Apps**; also
   inspect repository **Settings → Integrations → GitHub Apps**. For each App
   with all-repository access or this repository selected, open **Configure**
   without editing. This repository is personal-owned, so there is no owning
   organization's webhook list to substitute for this inventory.
2. Record App name, selected/all repository scope, and read/write permissions
   for contents, PRs, Actions/workflows, checks/statuses and deployments. Include
   Cloudflare and Vercel if present, plus automation/review/merge Apps.
3. Check push/PR/check/status event reactions and provider-side auto-merge,
   main-write, workflow-dispatch or deployment settings. Installer screens may
   not expose App webhook subscriptions or destinations: use publisher/provider
   evidence, or keep the field **UNKNOWN**. For an owner-managed custom App,
   its Developer settings → GitHub Apps → Permissions & events can provide that
   evidence. Do not request webhook secrets or private keys.

See [GitHub installed-App inspection](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps).

### Vercel

API limitation: team/default `GET /v1/webhooks` returned 403. Project-summary
tools omitted deploy hooks; an omitted field is not an empty list. No authorized
CLI fallback was available. Do not keep retrying those APIs unchanged.

1. Select the verified team `amphons-projects-bb1ec3bf`. Open **Settings → Webhooks**
   in view-only mode; record count, project scope and events. If unavailable,
   record the access/plan limitation, not “none.” Integration webhooks need their
   own review under the relevant integration settings.
2. For each of the seven projects listed in the release review, open **Project
   Settings → Git**. Check connected repository, production branch, branch/preview
   deployment controls and the **Deploy Hooks** list. Record each hook's display
   name and branch, never its URL. Check measurement/unlinked projects too.
3. Review team Integrations and the matching GitHub App configuration. Trace any
   relay or hook caller that can turn a QA push/PR/check into a deployment. Review
   other relevant teams/accounts or record explicitly that scope is incomplete.

Vercel distinguishes [team/integration webhooks](https://vercel.com/docs/webhooks)
from [incoming deploy hooks](https://vercel.com/docs/deploy-hooks). A direct Git
link search or an account plan label does not establish either inventory.

### Sanitized receipt for every relevant integration

| Field | Allowed receipt value |
| --- | --- |
| Provider/account/project/App | Human-readable label; no credentials |
| Evidence | Timestamp, reviewer, dashboard section/API status; redacted screenshot if needed |
| Repository/event/branch scope | Exact repository, push/PR/check/etc., branch patterns, previews on/off |
| Write/deploy capabilities | Yes / No / Unknown for main writes, auto-merge, workflow dispatch, deployment/version upload |
| Hooks | Count and display-name/branch/event scope; destination reviewed locally Yes/No, no URL |
| QA branch and exact SHA excluded? | Yes with policy evidence / No / Unknown |
| Relay/downstream behavior reviewed? | Yes with provider/owner evidence / No / Unknown |
| Coverage complete? | Owner confirms all relevant accounts/projects reviewed / incomplete |
| Decision | Isolated / requires separately approved freeze or configuration fix / HOLD |

Any Unknown for a relevant consumer remains HOLD. An owner assertion unsupported
by the configuration review is not a technical proof of isolation.

## 5. Documentation-only local commit candidate

**Prepared for approval, not committed.** Intended message:
`docs(evidence): prepare owner security approval and isolation gates`.
Its parent must remain `46bc4ec1d5d60af8111bd76ea41b6d8229c62f97` on the current
QA branch. Exactly these two paths belong in its proposed index:

| Path | Purpose |
| --- | --- |
| `docs/EVIDENCE_PUBLISHER_RELEASE_REVIEW.md` | Preserve the previous 193-line account-verification addition and add the authoritative owner-package handoff. |
| `docs/EVIDENCE_PUBLISHER_OWNER_APPROVAL_PACKAGE.md` | Ruleset proposal, pending Environment roster, one-file security PR plan, owner dashboard receipt and approval order. |

The original 62-path source manifest describes the existing commit and is not
expanded to pretend this candidate was already approved. No source/workflow,
fixture-only migration, log, environment file, credential or image is proposed
here. Embedded JSON is documentation only. An eventual documentation commit
would produce a **different SHA** and is not included in a proposed push of the
existing SHA; its remote push/PR behavior needs a separate review/authorization.

Local validation evidence for this candidate: branch/HEAD checks PASS; the full
previous working report is preserved by LF-normalized SHA-256 comparison
(`ad908cd6ca0166ac2809ef6914b87a6dd2b9f75576bb00cb0aa925dadb578df5`);
embedded Ruleset JSON parses and its target/approval/no-bypass/deletion/force-push
controls pass offline assertions. An initial heading-match assertion failed
because a Unicode marker was not preserved through the PowerShell/Node pipe;
using an ASCII anchor fixed the harness and the complete content hash matched.
This was not a content discrepancy and no report content was discarded. Only
documentation changes are proposed; application tests/build and the dispatcher
investigation were not repeated. No GitHub apply/import validation was executed.

## 6. Exact decision and approvals still needed

**For current repository and exact SHA
`46bc4ec1d5d60af8111bd76ea41b6d8229c62f97`: QA PUSH HOLD, PR HOLD.**

Confirmed: the local writer is default-disabled and main-only; eligible QA jobs
use synthetic inputs/read tokens with no running-job Production-secret reference;
connected Cloudflare Hub/Shop are main-only with previews off. Unknown: complete
installed-App permissions/event reactions, Vercel hook inventory, downstream relay
behavior and undisclosed account coverage. Main protection and independent
reviewer setup are also incomplete. Nothing in the proposed settings changes
those current facts until it is separately approved, applied and read back.

Owner approvals are separate, with the following dependencies:

1. **Local documentation commit only:** approve the exact two-path index and
   message above after final diff/secret checks. This grants no remote action.
2. **Reviewer nomination/access:** choose an independent qualified human; approve
   any necessary invitation/access grant separately. None is issued here.
3. **Main Ruleset / Environment settings:** approve the exact controls and resolved
   reviewer roster, acknowledge the initial required-check gap or require its
   separately approved CI remedy, inspect pending jobs, then apply only under a
   new explicit authorization and read back effective controls. No bypass grant.
4. **Apps/hooks evidence or isolation fixes:** complete the read-only dashboard
   receipts. Any settings change, deployment freeze or restoration needs explicit
   owner scope and its own verification. A security-only PR cannot yet be certified
   no-deploy; its branch/push/PR/merge each remains separately gated.
5. **QA push only:** after isolation gates close and rechecking current settings,
   authorize the exact branch and exact SHA, no other refs/tags. CI observation
   follows; a CI-only Draft PR requires a later explicit approval and PR-event
   isolation review. No broad merge authorization follows from either action.
6. **Production:** remains NO-GO. The failed unfinished-body ingress protection,
   independent review, migrations, credentials/permissions, real-provider rehearsal,
   Publisher activation and irreversible cleanup retain their existing independent
   release/owner gates. No approval in this package enables any of them.

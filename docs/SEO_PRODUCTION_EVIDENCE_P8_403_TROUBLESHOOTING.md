# P8 manual Workflow 403 troubleshooting — Run #45190777463

User-run Workflow: [Run 45190777463](https://github.com/noteroru2/amphon-product-hub-shop/actions/runs/45190777463). `discovery` Job #137748226122 failed after the environment gate, npm install and all eight P8 safety tests passed.

## Confirmed symptom

At `Collect GitHub + Cloudflare + public HTTP evidence` the original runner logged only:

```
SEO_PRODUCTION_EVIDENCE_UPSTREAM_READ_FAILED_403
```

Because the old collector handled GET errors without identifying which upstream refused the request, **the original run cannot distinguish a Supabase Data API denial, GitHub API rate limit/permission issue or Cloudflare API permission failure**. Treat any more specific claim as a hypothesis until a fresh run supplies the stage.

The original Workflow passed `AMPHON_SEO_GITHUB_READ_TOKEN` as empty, which is permitted for public repositories; unauthenticated GitHub REST requests may receive 403 on rate limit exhaustion (see [GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). This is a plausible cause, not confirmed.

## Safe code fix

- Use GitHub Actions built-in `github.token` as a read-only fallback when the optional named GitHub read token is empty. Job permissions remain `contents: read`. This improves GitHub REST authentication with no new secret.
- Errors from known allowlisted GET stages now contain **only** the stage and HTTP status. No token, URL, raw response, JSON, provider notes or customer data are logged.
- Tests simulate HTTP 403 at five provider endpoints and reject accidental token/response disclosure.
- Zero changes to Worker source, Supabase migration, CDN, DNS, SEO pages, GitHub push, PR creation, `PRODUCTION_VERIFIED` or any owner gate.

## How to rerun *after the fix is merged*

**Do NOT press `Re-run jobs` on Run #45190777463**: GitHub reruns the original revision, so the old error message would reappear.

Instead open [SEO Production Evidence Discovery](https://github.com/noteroru2/amphon-product-hub-shop/actions/workflows/seo-production-evidence-readonly.yml), choose **Run workflow** → Branch **main** → Site **amphon** → Leave `expected_sha` blank → Run workflow. If Environment approval is pending, have the configured reviewer approve.

The new error states identify only one of:

| Diagnostic | Meaning | Action |
|---|---|---|
| `SEO_PRODUCTION_EVIDENCE_SUPABASE_SITES_HTTP_403` | Supabase Data API denied site registry read | Check the correct project URL and server-side Service Role Key; verify API privileges, RLS and key format using Supabase Dashboard. Do not paste the key into issues or chat |
| `SEO_PRODUCTION_EVIDENCE_SUPABASE_PROJECTS_HTTP_403` | Supabase Data API denied the production mapping read | Same read permission checks on `commerce_seo_portfolio_projects` |
| `SEO_PRODUCTION_EVIDENCE_GITHUB_BRANCH_HTTP_403` | GitHub refused registered branch read | Check the Actions token has `contents:read`, that the repo can be accessed, or rate-limit/visibility constraints |
| `SEO_PRODUCTION_EVIDENCE_GITHUB_COMPARE_HTTP_403` | GitHub refused full-SHA ancestry read | Check repository/ref permissions and GitHub API rate limits |
| `SEO_PRODUCTION_EVIDENCE_CLOUDFLARE_DEPLOYMENTS_HTTP_403` | Cloudflare denied Worker deployment read | Cloudflare Token Account permission should be **Workers Scripts: Read** for the **correct account**, and token IP/expiry conditions must permit GitHub-hosted runners. Verify token permissions separately; never upgrade to Edit just to fix a read failure |

If all upstream reads work, the Workflow uploads a 7-day redacted `seo-production-evidence-amphon` artifact. Its JSON must still state `production_verified:false`, `can_write_ledger:false` and `can_deploy:false` — that's correct for evidence discovery.

Never disclose any secret values, Cloudflare API token, service-role key, GitHub token or authorization headers in screenshots or logs.

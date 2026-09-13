# SHOP-6.1 Worker Hotfix v6

Fixes the Cloudflare Worker deployment failure:

`Invalid TOML document: newlines are not allowed in strings`

Changes:
- Worker config is generated as `workers/r2-upload/wrangler.jsonc` instead of TOML.
- Wrangler is always called with an explicit `--config` path.
- Worker secrets are uploaded from a temporary JSON file, not dotenv/TOML-like text.
- Old installer-generated `workers/r2-upload/wrangler.toml` is removed.
- `RESUME-FROM-CLOUDFLARE.bat` skips the already-passed database migration and npm install steps.
- Required public config values are rejected if they contain CR/LF.

For the current install state (database acceptance PASS and npm install PASS), copy this hotfix over the existing project and run `RESUME-FROM-CLOUDFLARE.bat`.

# Notebook Coverage — 66 unpriced observed groups (2026-11-07)

Owner uploaded the latest fully updated Notebook Coverage. It **is not a stale UI**. It shows:
- 270 notebook inventory rows
- 114 observed CPU/GPU buckets and 205 total buckets (including zero-evidence taxonomy)
- Gaming 10 / Office 43 / Business 14 / Gap 11 staged rule groups
- 48 observed buckets with matching staged price proposals, 66 without
- 38 of the 66 are MACBOOK, REVIEW or RTX3050_UNSPEC buckets (require exact model or verified hardware). This classification can overlap with other missing traits, so it is not an exhaustive root-cause audit.
- 28 remaining unpriced observed groups genuinely have no current matching staged rule or need individual pricing review. No permission to invent price or mark PENDING as live.
- History Gap 11 remains PENDING; it already displays correctly for i5 Gen11 + RTX3060 and Business i3 Gen11; do not duplicate these.

Confirmed parser defect: AMD Athlon 3050U in two actual stock names was parsed as an RTX3050 because legacy permissive regex matched `3050` inside `3050U`. Requires a full token boundary. This patch corrects and tests it; it never converts unspecified RTX3050 VRAM to 4GB or 6GB.

UI fix: default Coverage to **historically observed** only; filter specifically unpriced observed buckets, or need-verification/macbooks, with explicit option to view the full catalog. Expand examples to identify historical stock products; keep Owner approval status distinct from live prices.

No changes to Active V2.7, V2.8, approval status, inventory buy/sale history or LINE AUTO.

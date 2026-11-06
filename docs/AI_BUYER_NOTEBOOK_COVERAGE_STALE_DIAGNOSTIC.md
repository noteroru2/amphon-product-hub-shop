# Notebook Coverage stale snapshot + missing-price diagnostics (2026-11-06)

User pasted a 270 notebook / 97 observed group / 183 catalog group report. The first paragraph of that report is the **older** UI message prior to the Historical Pricing Gaps PR #147 and Spec Verification PR #148. It has MacBook buckets `Apple M1`, `Apple M2` instead of Air/Pro + chip + RAM + SSD + screen, and does not show historical gap PENDING suggestions for `i5 Gen 11 / RTX3060` or `Business i3 Gen11`. Current code on main has those changes and production deploy succeeded, so uploaded report cannot establish current runtime behavior.

This patch makes stale UI identifiable with a visible module/version marker and exact client load timestamp. It adds count of matched vs unmatched *observed* CPU/GPU buckets, number of loaded rule entries by source, and specific "must verify VRAM" and "MacBook model" reasons. It does NOT override existing draft or active prices or turn on LINE AUTO. A reported match is descriptive, not a permitted customer quote.

Expected workflow: hard-refresh Hub once, open Notebook Coverage, click รีเฟรช; compare version marker and counts. Historical gap proposals remain PENDING until Owner explicitly approves. Any CPU/GPU ambiguity must remain unpriced.

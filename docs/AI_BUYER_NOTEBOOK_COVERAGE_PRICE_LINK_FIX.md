# Notebook Coverage price columns

Root cause: Notebook Coverage table previously displayed historical cost medians and a hardcoded "ดูรายการกฎ Owner แยก" placeholder for every row, never joining the Owner-specific staged pricing tables.

This change loads the latest relevant stages from `ai_buyer_notebook_rule_batches`, `ai_buyer_office_notebook_rule_batches` and `ai_buyer_business_notebook_rule_batches`, then maps CPU/GPU buckets to opening price intervals, displaying the actual status `PENDING` or `APPROVED_DRAFT`. The full model-specific MacBook PriceBook cannot be safely joined to a broad "Apple M1" bucket; retain requirement to check MacBook Air/Pro, RAM, SSD, model code and condition before quoting.

Safety:
- BUSINESS and GENERAL never cross-join (Business price is lower).
- Distinguish GTX1050 vs GTX1050Ti, RTX3050 4GB/6GB, exact Intel generation; do not match a GPU with UNKNOWN VRAM or CPU.
- For integrated/unknown GPU labels, warn that exact GPU and RAM/SSD must be verified.
- For Core Ultra Series 2+ use PER_MODEL null amount, no conversion to zero.
- No match or multiple overlaps -> no price, explaining the missing rule/verification.
- This is a read-only presentation of draft rules. It does not activate LINE AUTO, change active PriceBook V2.7 or modify customer-facing Worker pricing.

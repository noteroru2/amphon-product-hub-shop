# AI Buyer P0 Regression + Offline Replay Report

Date: 2026-09-22  
Policy: AMPHON_AI_BUYER_OPTIMIZATION_V1  
Replay run: 5eca5572-216e-4ff2-a98e-631ed9bf45a3  
Mode: OFFLINE / NO OPENAI  
AI runtime: PAUSED

## Result

The deterministic replay completed successfully against stored Supabase evidence only.

- Total cases: 81
- A — evidence sufficient to price: 17
- B — genuinely needs material information: 36
- C — Human Review / unsupported / risk: 28
- Cases exposing at least one production regression signal: 22
- Curated P0 regression fixtures: 15
- Fixture failures: 0
- BATTERY_TAG_MISSING: 0
- BATTERY_PRICED_NORMAL: 0

CI result: **PASS**

## Main production regressions found

- READINESS_STATE_MISMATCH: 14
- UNNECESSARY_PREPRICE_REQUEST: 11
- RISK_ESCALATION_MISSING: 7
- OVER_ESCALATED_TO_HUMAN: 1

A single case can contain more than one regression code.

## Evidence-ready cases currently blocked by old behavior

Examples found by the replay:

- ASUS ExpertBook B3402FE — exact model code already known.
- Acer Aspire Go 15 AG15-72P — exact model code already known.
- MacBook Pro 16-inch 2019 — model/year/storage already known.
- iPhone 11 64GB — model/storage known; battery degradation is also known and preserved.
- iPhone 15 Pro Max 256GB — exact variant known.
- Huawei AGS3-L09 3GB/64GB — exact model/storage known.
- Xiaomi Pad 7 Pro 12GB/512GB — model/storage known.
- Several compact cameras with exact readable model/model-code were still asking for accessories/serial/extra photos before pricing.

These are readiness regressions, not permission to ignore later condition evidence. The first quote may proceed from sufficient identity/variant evidence while known defects remain mandatory price adjustments.

## Safety/risk cases caught by replay

Examples include:

- Multiple devices with uncertain spec-to-device mapping.
- Device not booting.
- Major multi-part damage.
- Identity conflict between readable device evidence and customer-stated model.
- Active installment / ownership or pawn-ticket verification risk.
- Unsupported OTHER-category items.

These remain Human Review and must not be promoted by the more permissive readiness rules.

## Battery regression

The replay independently derives battery degradation from structured evidence, then compares it with stored pricing tags and prior pricing decisions.

Current replay:
- Missing BATTERY_BAD tags: 0
- Existing priced cases where a known bad battery was priced without deduction: 0

The iPhone 11 64GB / 64% battery case is part of the permanent regression fixture set.

## Permanent regression suite

15 real production cases are pinned as regression fixtures. They cover:

- exact notebook model-code readiness
- clear smartphone model/storage readiness
- MacBook model/year/storage readiness
- tablet readiness
- degraded battery preservation
- multiple-device ambiguity
- major damage
- identity conflict
- ownership/finance risk
- missing storage
- missing model
- missing desktop core spec

The CI workflow refuses to run the replay unless `AI_BUYER_PAUSED=true`.

## Code hardening completed with P0

- Deterministic readiness reason codes.
- Removal of redundant evidence requests when facts are already known.
- Sticky prior pricing tags.
- Deterministic Human Review guard for critical defect tags.
- Deterministic risk guard for multiple-device ambiguity, identity conflict, and ownership/finance risk.
- Offline replay audit tables and repeatable database RPC.
- CI runner that uses Supabase only and never calls OpenAI.
- Regression fixtures sourced from real cases.

## Important interpretation

`A_PRICE_NOW` means the case has enough evidence to attempt pricing. It does not guarantee an automatic final price.

The pricing engine can still stop at Human Review if:
- the Price Book has no safe match,
- verified market comparables are insufficient,
- market prices are too dispersed,
- a hard-risk defect exists,
- or the variant remains materially ambiguous.

This distinction prevents the old “wait for photos forever” behavior without weakening price safety.

## Next gate

Do not re-enable OpenAI yet.

The next optimization pass should reduce the remaining pricing-engine blockers among the 17 evidence-ready cases, especially MARKET_COMPARABLES_INSUFFICIENT and unmapped model/spec paths, then rerun this same P0 suite before any controlled reopen.

# AI Buyer Optimization — A. Implementation Spec

Version: 1.0  
Date: 2026-09-22  
Runtime state: **AI processing paused**. LINE webhook ingestion remains active so new messages/images can be retained without calling OpenAI.

## 1. Goal

Raise the number of genuinely priceable cases without lowering buyback safety. The system must stop treating optional photos as mandatory when the model/spec evidence is already sufficient.

The order of authority is:

1. Confirmed customer text.
2. Clearly readable model label / About / system information.
3. Confirmed image evidence.
4. Structured prior observations from the same case.
5. Inference only when it does not change a critical variant.

Price Book remains first choice. If no reliable row exists, use verified market comparables when that category is enabled. Price Guard remains authoritative for hard max.

## 2. P0 — Readiness engine

### 2.1 Replace photo-driven readiness with evidence-driven readiness

A case becomes READY_TO_PRICE when its category policy is satisfied even if condition photos are incomplete. Pricing is allowed only for SELL_ITEM intent; purchase/general inquiries must not enter pricing.

Do not keep a case in COLLECTING_PHOTOS solely because charger/accessories/cosmetic/battery photos are absent.

### 2.2 Preserve evidence across turns

Merge prior confirmed observations before making the next decision. A later short message must not wipe previously known CPU/GPU/RAM/storage/model or defect information.

### 2.3 Never request the same evidence twice

Before adding a requested input, check confirmed facts and prior observations. A readable model code / About screen / system screen counts as direct evidence.

### 2.4 Core readiness

Only one non-terminal valuation case may exist per conversation. Active-case creation must be atomic so parallel LINE image events cannot create duplicate shells.

- NOTEBOOK: brand + series/model + CPU + GPU/integrated + RAM + storage. Identity >= 0.80.
- DESKTOP_PC: CPU + GPU/integrated + RAM + storage. Identity >= 0.65. Motherboard/PSU/system class improve accuracy but are not hard blockers; missing values use conservative defaults.
- SMARTPHONE/TABLET: exact model + storage variant. Identity >= 0.90.
- MACBOOK: model/model-code + chip/year + storage; RAM preferred but not always blocking. Identity >= 0.90.
- CAMERA: exact model; body/lens bundle must be known when it materially changes value. Identity >= 0.90.
- OTHER: human review by default until a dedicated pricing policy exists.

Notebook exact model-code may attempt verified market fallback if spec pricing cannot map every component.

## 3. P0 — Defect and battery guard

Known defects are sticky facts. A later analysis that does not mention the defect must not remove it.

Battery rule:
- Battery health < 80% => BATTERY_BAD.
- “Service recommended”, “significantly degraded”, “แบตเสื่อม”, “ไม่เก็บไฟ”, “หมดไว” => BATTERY_BAD.
- BATTERY_BAD must either deduct the configured amount or escalate. It must never silently price as NORMAL.

Major risk conditions remain human review: locked device, not booting, major damage, severe ambiguity, liquid/board history, intermittent power, and other category-specific critical defects.

## 4. P0 — Variant safety

Never let a broad model match override a confirmed storage/variant mismatch.

Examples:
- iPhone 11 64GB must not use a 128GB row.
- MacBook 8/256 must not use a 16/512 row merely because the family name matches.
- Camera body-only must not match a body+lens bundle row.

If variant conflicts, reject the Price Book row and fall back to market or Human Review.

## 5. P0 — State machine

Use these operational meanings:

- NEW: ingested but not analyzed.
- IDENTIFYING_PRODUCT: product/category/model not sufficiently known.
- WAITING_REQUIRED_INFO: missing information that materially affects price.
- READY_TO_PRICE: evidence is sufficient under category policy.
- PRICING: pricing engine is running/has a decision being prepared.
- HUMAN_REVIEW: ambiguity/risk/unsupported item requires admin.
- OFFERED / NEGOTIATING / ACCEPTED / ACTION_REQUIRED: offer workflow states.

COLLECTING_PHOTOS should be treated as a legacy presentation state and phased out for cases where only optional images are missing.

## 6. Reason codes

Every non-final case must expose one primary reason:

READY_BY_COMPLETE_SPEC  
READY_BY_MODEL_IDENTITY  
READY_BY_MODEL_CODE  
MISSING_PRODUCT_TYPE  
MISSING_MODEL  
MISSING_STORAGE_VARIANT  
MISSING_CORE_SPEC  
MODEL_SPEC_CONFLICT  
MULTIPLE_DEVICES_AMBIGUOUS  
MODEL_VARIANT_AMBIGUOUS  
BATTERY_BAD  
KNOWN_DEFECT_ADJUSTED  
MAJOR_DAMAGE  
DEVICE_NOT_BOOTING  
LOCKED  
MARKET_COMPARABLES_INSUFFICIENT  
HUMAN_REVIEW_REQUIRED

Dashboard should display and filter these codes.

## 7. P1 — Backlog replay without OpenAI

While AI is paused, classify the stored cases from existing structured observations and messages only.

For each case record:
- expected_state
- expected_reason
- priceable_without_new_customer_input
- missing_material_fields
- known_defect_tags
- actual_state

Do not call OpenAI during this replay.

Create four buckets:
A. Should price now.
B. Needs 1–2 material fields.
C. True Human Review.
D. Incorrect behavior/regression case.

Bucket D becomes the permanent regression suite.

## 8. P1 — Pricing path

1. Check category policy.
2. Check variant conflicts.
3. Apply sticky known defects.
4. Price Book exact/reliable match.
5. Spec pricing for Notebook/Desktop.
6. Verified market fallback if enabled.
7. If comparables are insufficient or dispersed, Human Review.
8. Create opening/target/hard max.
9. Price Guard validates every offer.

## 9. P1 — Dashboard

Add:
- Ready but unpriced
- Missing model
- Missing storage variant
- Missing core spec
- Known defect
- Battery bad
- Duplicate evidence request
- Market fallback
- Human review by reason

Filters: category, state, reason code, pricing path, defect tag.

## 10. Acceptance gates before re-enabling AI

Must all pass:
- Complete-spec but still waiting for photo = 0.
- Clear model but unidentified = 0.
- Known BATTERY_BAD priced as normal = 0.
- Duplicate evidence requests = 0.
- Auto-price rate target >= 40% of eligible supported-category cases.
- Human review target <= 30% of eligible supported-category cases.
- Hard max guard tests = 100% pass.
- Regression suite = 100% pass on previously incorrect cases.

AI remains paused until these gates are measured and accepted.

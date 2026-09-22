# AI Buyer P0 — Deal Outcome Ledger + Final Deal Label + Manual Reply Capture

Date: 2026-09-22  
Runtime: AI processing remains paused. LINE ingestion and human operations remain active.

## Purpose

This P0 closes the learning loop from a customer conversation to real business outcome:

`LINE chat -> owner/manual price -> final deal label -> purchase -> inventory -> sale -> gross profit -> future BookPrice calibration`

The system now separates three different truths that must never be conflated:

1. **Customer accepted a number** — agreement exists but item may not have arrived yet.
2. **Store actually purchased the item** — acquisition cost is real.
3. **Store actually sold the item** — realized resale and profit can calibrate BookPrice.

## 1. Final Deal Label

Table: `ai_buyer_case_outcomes`

Exactly one verified final outcome is stored per valuation case.

Supported labels:

- `AGREED_PENDING_HANDOVER`
- `PURCHASED`
- `CUSTOMER_DECLINED_PRICE`
- `CUSTOMER_NO_RESPONSE`
- `SOLD_ELSEWHERE`
- `CONDITION_REJECTED`
- `IDENTITY_MISMATCH`
- `OWNERSHIP_RISK`
- `OUTSIDE_POLICY`
- `CANCELLED_OTHER`

`AGREED_PENDING_HANDOVER` requires `final_agreed_price`.

`PURCHASED` requires `purchase_price` or a final agreed price that can be used as the purchase cost.

The outcome trigger updates the case state and, for purchased cases, creates the first Deal Ledger line automatically.

Hub API:

`POST /v1/hub/admin/final-outcome`

Example payload:

```json
{
  "caseId": "<uuid>",
  "finalLabel": "PURCHASED",
  "finalAgreedPrice": 5200,
  "purchasePrice": 5100,
  "reasonCode": "OWNER_CLOSED",
  "note": "ลูกค้านำเครื่องมาส่งที่ร้าน"
}
```

## 2. Deal Outcome Ledger

Table: `ai_buyer_deal_ledger`

One case may contain multiple ledger lines for lots/multiple products.

Each line records:

- acquisition price,
- acquisition date,
- linked Hub product,
- repair cost,
- parts cost,
- transport cost,
- warranty cost,
- channel fee,
- other cost,
- realized sale price,
- sale channel,
- sale date,
- whether sale price is verified.

Generated fields:

- `total_cost`
- `gross_profit`

Aggregated view:

`ai_buyer_deal_ledger_case_v`

This is the primary future training/calibration source for profit-aware BookPrice.

Hub API:

- `GET /v1/hub/admin/deal-ledger?caseId=<uuid>`
- `POST /v1/hub/admin/deal-ledger`

When a ledger line is linked to `products.id`, the ledger can synchronize:

- product cost from `product_financials`,
- sold state / sold date from Product Hub,
- verified online sale price from a completed commerce order,
- Hub sold price as a non-verified fallback when no commerce-order price exists.

Manual verified sale price always has precedence over automatic sources.

## 3. Manual Reply Capture

Hub API:

`POST /v1/hub/admin/manual-reply`

Example payload:

```json
{
  "caseId": "<uuid>",
  "text": "ถ้าเครื่องใช้งานปกติและจอไม่มีตำหนิ ผมรับได้ 5,200 บาทครับ",
  "offerAmount": 5200
}
```

Flow:

1. Authenticated owner/admin prepares an idempotent outbound action.
2. Worker pushes the text to the customer through LINE Messaging API.
3. After successful delivery the exact owner text is archived as an `OUTBOUND/TEXT` message.
4. Message metadata uses `source=OWNER_MANUAL`.
5. The five-day learning trigger copies it into `ai_buyer_learning_events` with speaker `OWNER_MANUAL`.
6. When `offerAmount` is provided, the system also records the owner quote and a human override against the latest pricing decision when available.
7. A `PRICE_QUOTE` learning label is written with confidence 1.0.

This means replies sent from **Amphon Hub** no longer need CSV recovery.

Replies typed directly in **LINE Official Account Manager** still require the LINE OA chat-history export because LINE webhook events do not include the body of those manual OA Manager replies.

## 4. Learning labels from final outcomes

Verified final outcomes are copied into every learning window that contains evidence for the case.

- Agreement / purchased -> `CUSTOMER_ACCEPTED`
- Lost / rejected / expired -> `CUSTOMER_DECLINED`

The label payload retains final price, purchase price, reason code and time so Day-5 analysis can distinguish a quoted price from a genuinely completed purchase.

## 5. Safety

- Only authenticated Hub owner/admin users can send manual replies or label outcomes.
- Manual replies have idempotency keys and outbound-action audit records.
- Human manual quotes are preserved rather than silently rewritten by the AI.
- AI production remains paused.
- Existing SHADOW category controls remain unchanged.
- Profit calibration must use verified purchase/sale outcomes where available.
- Candidate BookPrice changes still require Offline Replay and owner approval before production.

## Day-5 BookPrice calibration priority

Evidence should be weighted in this order:

1. Purchased + sold + verified sale price.
2. Purchased but still in stock.
3. Agreed pending handover.
4. Owner quote but no acceptance.
5. External market comparables.

For each reliable product cluster compute:

- owner opening-offer distribution,
- final agreed-price distribution,
- actual purchase-cost distribution,
- repair/extra-cost distribution,
- realized sale-price distribution,
- inventory days,
- realized gross profit,
- realized gross margin,
- recommended opening / target / hard-max candidate.

Low sample counts remain Human Review / low-confidence candidates.

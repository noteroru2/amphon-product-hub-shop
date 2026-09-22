# AMPHON AI Buyer V1

LINE OA photo-first buyback agent.

## Completed checkpoints

### Checkpoint 1 — Foundation
- verifies LINE `x-line-signature` against the raw request body
- deduplicates with `webhookEventId`
- stores customer / conversation / valuation case / messages
- copies inbound LINE images immediately to R2
- stores LINE image-set metadata
- keeps pricing tables and server-side `hard_max` constraints ready for the Pricing stage

### Checkpoint 2 — Conversation + Vision Intake
- debounces consecutive LINE messages/images with a Durable Object
- analyzes a customer batch once instead of replying to every image
- sends text + new images to the OpenAI Responses API
- uses Structured Outputs for a strict intake contract
- separates facts into CONFIRMED / INFERRED / UNKNOWN
- classifies supported product categories
- computes identity/spec/condition/readiness scores
- requests only the most useful missing inputs
- generates short Thai admin-style questions from deterministic templates
- never lets the Vision model quote or invent a price
- moves sufficiently complete cases to `READY_TO_PRICE`
- moves ambiguous/rare/complex cases to `HUMAN_REVIEW`
- honors `HUMAN_ACTIVE` and explicit admin handoff requests
- answers truthfully if the customer asks whether the system is AI/automatic
- audits each vision run in `ai_buyer_analysis_runs`

## Routes

- `GET /v1/health`
- `POST /v1/webhooks/line`

## Required Cloudflare Worker secrets

```bash
cd workers/ai-buyer
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put AI_BUYER_ADMIN_TOKEN
```

Never commit these values.

## Database migrations

Apply in order:

```text
supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql
supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql
supabase/migrations/20260919173000_ai_buyer_checkpoint2_indexes.sql
supabase/migrations/20260919180000_ai_buyer_checkpoint3_pricing.sql
supabase/migrations/20260920085454_ai_buyer_checkpoint35_spec_pricing.sql
```

AI Buyer tables use RLS with no browser policies at this stage. The Worker uses the Supabase secret key server-side.

## Image batching

`ConversationBatcher` is a Durable Object keyed by conversation ID.

Every new message resets a short debounce alarm. Default:

```text
AI_BUYER_BATCH_DEBOUNCE_MS=2500
```

This allows a customer to send several photos consecutively while producing one analysis/reply.

## Vision model

Configured by:

```text
OPENAI_VISION_MODEL=gpt-5.6-sol
```

The engine sends image inputs through the Responses API and requests strict JSON-schema output. The model is not allowed to produce purchase prices; pricing remains a separate future checkpoint.

## Checkpoint 2 output

The vision engine returns operational fields only:

- intent
- category
- model name / model code
- confirmed facts
- inferred facts
- unknown fields
- requested photo/input codes
- identity confidence
- spec completeness
- condition completeness
- pricing readiness
- next action
- handoff / AI-disclosure flags

The customer-facing text is produced by application templates, not copied directly from free-form model prose.

## Current safety boundary

Checkpoint 2 may ask for missing product information and acknowledge when a case is ready for pricing.

It **does not**:
- calculate a buy price
- search market prices
- negotiate
- send an offer
- exceed or bypass future pricing controls

## Next checkpoint

Checkpoint 3:

1. Price Book importer/versioning
2. exact + alias + spec matching
3. Market Pricing fallback contract
4. category buyback rules
5. server-side Price Guard
6. produce `opening_offer / target_buy / hard_max`


## Checkpoint 3 — Price Book + Pricing Engine + Price Guard

Checkpoint 3 adds a deterministic pricing boundary after `READY_TO_PRICE`.

### Pricing order

```text
READY_TO_PRICE
  ↓
Active Price Book
  ↓
Exact model code → alias → model → token/spec match
  ↓
Found and unambiguous?
  ├─ YES → apply controlled pricing tags/adjustments → Pricing Decision
  └─ NO  → Market fallback only when category.market_enabled=true
               ↓
          OpenAI web search
               ↓
          validate comparable URLs against returned web-search sources
               ↓
          reject wrong condition/spec/unverified sources
               ↓
          median + dispersion gate
               ↓
          category buyback rule
               ↓
          Pricing Decision
```

The OpenAI Responses API currently supports built-in web search and can include
`web_search_call.action.sources`; the runtime uses those returned sources to reject
comparables whose URLs cannot be tied back to actual search evidence.

### Pricing Decision contract

Every accepted pricing result stores:

- `estimated_resale`
- `opening_offer`
- `target_buy`
- `hard_max`
- `current_authorized_offer`
- `pricing_confidence`
- source (`PRICE_BOOK` or `MARKET`)
- adjustments
- comparable evidence / rationale

Checkpoint 3 creates the decision but does **not** send a numeric offer to LINE yet.
Offer delivery and negotiation belong to Checkpoint 4.

### Price Guard

There are two independent guard layers:

1. application guard: `guardOffer()`
2. PostgreSQL trigger: `ai_buyer_offer_price_guard`

Any AI/admin offer above the Pricing Decision `hard_max` is rejected by PostgreSQL,
even if future application code accidentally bypasses the TypeScript guard.

### Price Book import

Admin-only endpoint:

`POST /v1/admin/price-book/import`

Header:

`x-ai-buyer-admin-token: <AI_BUYER_ADMIN_TOKEN>`

Example payload:

```json
{
  "version_name": "2026-09-19-v1",
  "source_name": "AMPHON master price sheet",
  "activate": true,
  "entries": [
    {
      "category": "NOTEBOOK",
      "brand": "ASUS",
      "model": "TUF A15 FA506IC",
      "model_code": "FA506IC",
      "aliases": ["TUF A15 3050"],
      "spec_match": {
        "gpu": "RTX 3050"
      },
      "estimated_resale": 13900,
      "opening_offer": 8500,
      "target_buy": 9000,
      "hard_max": 9500,
      "adjustments": {
        "NO_CHARGER": -500,
        "BATTERY_BAD": -500,
        "SCREEN_DEFECT": -1500
      }
    }
  ],
  "category_rules": [
    {
      "category": "NOTEBOOK",
      "market_enabled": true,
      "buyback_percent": 0.65,
      "min_buyback_percent": 0.55,
      "max_buyback_percent": 0.70,
      "hard_max_percent": 0.68,
      "opening_discount_percent": 0.05,
      "risk_reserve": 300,
      "rounding_step": 100,
      "min_market_comparables": 3,
      "max_market_dispersion": 0.35
    }
  ]
}
```

No market rule is enabled automatically. The business must explicitly configure
the percentage and enable each category.

### Admin guard inspection

`POST /v1/admin/price-guard/check`

This endpoint is protected by the same admin token and can verify an amount against
an existing Pricing Decision before Checkpoint 4 is enabled.


## Checkpoint 3.5 — AMPHON V2.3 Spec Pricing Integration

Checkpoint 3.5 adopts the temporarily approved business baseline:

`AMPHON Master Price Book V2.3`

Source checksum:

`5f6578b5d6e5219c2d2a7e527beaeecb1e3ffcb18a79a8bf95c7f0e372663067`

The repository records its runtime manifest at:

`workers/ai-buyer/data/amphon-price-book-v2.3.manifest.json`

### Pricing strategy by category

- NOTEBOOK: spec-based
- DESKTOP_PC: spec/component-based
- MACBOOK: model-based
- SMARTPHONE: model-based
- TABLET: model-based
- CAMERA: model-based

Notebook pricing uses base chassis + CPU + GPU + RAM + SSD + display +
brand/series + controlled condition/defect/warranty adjustments, then a series
liquidity factor.

Desktop pricing uses CPU + GPU + motherboard + RAM + storage + PSU + case +
cooler + system-class modifier, then a system liquidity factor.

### Safety behavior

- CPU/GPU with LOW component confidence require Human Review.
- Missing required spec keys require Human Review.
- High-risk defects still require Human Review.
- REVIEW model rows from V2.3 are stored inactive for automatic model matching.
- Market fallback remains disabled unless explicitly configured.
- Every spec-based Pricing Decision records the active version, workbook checksum,
  formula settings, component trace and liquidity factor.
- Existing application Price Guard and PostgreSQL hard-max trigger remain unchanged.

### Production data state

The V2.3 data baseline is loaded and active in Supabase. It contains:

- 275 notebook/desktop component and modifier rows
- 2 spec-pricing settings rows
- 45 model-based rows
- 27 model rows eligible for automatic model matching
- 18 model rows retained as REVIEW/inactive
- owner calibration evidence stored separately

This does **not** mean LINE automatic buying is live. The Worker code remains on
the feature branch until deployment is explicitly approved, and Checkpoint 4 is
still responsible for guarded offer delivery, negotiation and acceptance.


## Checkpoint 4 — Offer + Negotiation + Acceptance + Fulfillment

Checkpoint 4 turns a guarded Pricing Decision into an auditable purchase conversation.

### Rollout control

Every category has an explicit mode in `ai_buyer_category_automation_modes`:

- `SHADOW` — calculate/create the guarded offer for review, but do not send a numeric price.
- `APPROVAL` — prepare the guarded offer and create an `OFFER_APPROVAL` admin task; an admin must approve before LINE push.
- `AUTO` — send the guarded opening offer and allow deterministic negotiation.

All categories default to **SHADOW**. Deployment alone cannot turn automatic buying on.

Admin endpoints:

- `GET /v1/admin/automation-mode`
- `POST /v1/admin/automation-mode`
- `POST /v1/admin/offer/approve`

All require `x-ai-buyer-admin-token`.

### Offer safety

Shop-originated offers now use the transactional RPC
`ai_buyer_create_guarded_offer`.

It enforces:

- Pricing Decision belongs to the case.
- pricing confidence >= 0.85.
- amount <= `hard_max`.
- concessions are monotonic; the AI cannot lower a previously authorized offer.
- an idempotency key is mandatory.
- accepted/terminal cases cannot reopen negotiation.

The original database hard-max trigger remains as a second independent guard.

### Negotiation policy

Negotiation is deterministic and does not give an LLM authority to choose money.

The engine parses explicit customer counters and uses a bounded concession ladder:

1. midpoint from current offer toward target
2. target buy
3. midpoint from target toward hard max
4. hard max

The configured maximum number of rounds is stored per category. A shop offer can
never exceed hard max.

The engine does not use fake buyers, fake deadlines, fake scarcity or invented
market claims.

### Acceptance

Explicit Thai acceptance phrases such as `ตกลง`, `โอเค`, `ขายครับ`,
`เอาราคานี้`, `ได้ตามนั้น` and `มารับได้เลย` are recognized only when they
do not conflict with a different numeric counter.

`ai_buyer_accept_offer` atomically accepts only a **delivered** current shop
offer. Once accepted:

- the offer becomes `ACCEPTED`
- other proposed offers become `SUPERSEDED`
- `accepted_price` / `accepted_at` are frozen on the case
- state moves to `COLLECTING_FULFILLMENT`
- price negotiation cannot reopen

### Fulfillment handoff

After acceptance the engine collects only missing fulfillment fields:

- seller name
- phone
- method: `PICKUP`, `SHIP`, or `STORE_DROP`
- address or LINE location when required

When complete, the case moves to `ACTION_REQUIRED` and creates a
`PURCHASE_PICKUP` admin task containing the agreed price, pricing snapshot,
customer/contact details, fulfillment data, images, and recent important messages.

### Duplicate-send protection

`ai_buyer_outbound_actions` stores an idempotency key and delivery state for
offer, negotiation, and fulfillment messages. Pending replies carry their
offer/action IDs so a retry can mark the same offer delivered rather than
creating a new price.

### Database migration

`supabase/migrations/20260920093721_ai_buyer_checkpoint4_offer_negotiation.sql`

The migration is applied to production, but all rollout modes remain SHADOW.
The Cloudflare Worker is still not considered live until deployment is explicitly approved.


## P0 — Deal Outcome Learning Loop

The current optimization phase keeps OpenAI processing paused while capturing verified human operating data.

### Hub owner/admin routes

- `POST /v1/hub/admin/manual-reply` — sends an exact owner/admin LINE reply through the Messaging API and archives it as `OWNER_MANUAL`.
- `POST /v1/hub/admin/final-outcome` — records the verified final deal label and final/purchase price.
- `GET /v1/hub/admin/deal-ledger?caseId=<uuid>` — reads acquisition-to-sale economics.
- `POST /v1/hub/admin/deal-ledger` — records/updates purchase, repair, logistics, fees and realized sale price.

These Hub routes use the authenticated Supabase user and require owner/admin role.

### Final outcome vs realized economics

`ai_buyer_case_outcomes` stores one verified final label per valuation case.

`ai_buyer_deal_ledger` stores one or more acquired items and follows them through inventory and sale.

A `PURCHASED` outcome creates the first ledger row automatically. If that row is linked to `products.id`, Hub product/financial/order changes can synchronize cost and realized sale data.

Learning/calibration view:

`ai_buyer_learning_deal_dataset_v`

Unlabeled terminal/accepted cases:

`ai_buyer_final_label_queue_v`

### Owner manual reply capture

A manual Hub reply is prepared as an idempotent `MANUAL_REPLY` outbound action, pushed through LINE, and then finalized into `ai_buyer_messages`.

The five-day learning trigger recognizes:

`metadata.source = OWNER_MANUAL`

and stores speaker `OWNER_MANUAL` in `ai_buyer_learning_events`.

When an explicit `offerAmount` is supplied, the system records a verified `PRICE_QUOTE` learning label and an ADMIN offer/human override when a Pricing Decision exists.

Replies typed directly in LINE OA Manager still require chat-history export/import because their text bodies are not delivered back to the Messaging API webhook.

Full P0 contract:

`docs/ai-buyer/P0_DEAL_OUTCOME_LEDGER.md`

AI processing remains paused and category rollout remains SHADOW until explicit owner approval.

P0 invariant checks cover the manual-reply, final-outcome, and deal-ledger contracts.

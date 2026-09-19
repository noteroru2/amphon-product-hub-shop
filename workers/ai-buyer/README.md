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
```

Never commit these values.

## Database migrations

Apply in order:

```text
supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql
supabase/migrations/20260919170000_ai_buyer_checkpoint2_vision.sql
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

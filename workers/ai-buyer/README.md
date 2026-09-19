# AMPHON AI Buyer V1

Foundation for the LINE OA auto-valuation workflow.

## V1 foundation scope

This worker currently does **ingestion only**:

- verifies LINE `x-line-signature` against the raw body
- deduplicates using `webhookEventId`
- persists LINE customers, one long-lived conversation per LINE user, and active valuation cases
- stores inbound text/location/image messages
- copies LINE images into the existing `amphon-product-images` R2 bucket under the `ai-buyer/` prefix
- stores LINE image-set metadata for later multi-image batching
- records auditable webhook processing status

It does **not** reply to customers, analyze images, search market prices, or send offers yet.

## Routes

- `GET /v1/health`
- `POST /v1/webhooks/line`

## Required secrets

Set these as Cloudflare Worker secrets:

```bash
cd workers/ai-buyer
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

Never put these values in `wrangler.jsonc` or Git.

## Database

Apply:

`supabase/migrations/20260919163000_ai_buyer_v1_foundation.sql`

All AI Buyer tables have RLS enabled and no browser policies in this phase. The Worker uses the Supabase secret key server-side.

## LINE webhook target

After deployment configure LINE Developers Messaging API webhook URL:

`https://<worker-host>/v1/webhooks/line`

Do not enable production auto-replies until the Conversation Engine and Price Guard stages are complete.

## Next stage

1. image batching window
2. product/category intent classifier
3. image analysis contract: CONFIRMED / INFERRED / UNKNOWN
4. dynamic photo checklist
5. Price Book importer + exact/alias matching
6. server-side Price Guard
7. reply/negotiation engine

# AI Buyer Chat Price Control V1 — ChatGPT dialogue + Hub Owner approval

## Overview
Use ChatGPT to discuss purchase pricing in natural Thai and analyze AMPHON cost/sale evidence. When ready, have ChatGPT output structured JSON and paste it in **Hub → AI Buyer → Chat Price Control**. The Hub must independently show a current before/after PriceBook V2.8 Draft diff and require explicit owner confirmation. ChatGPT is never treated as the authenticated owner, and there is **no public chat endpoint that silently changes prices**.

This is the safe currently implemented release: **conversation → copy structured JSON → Hub diff → logged-in Owner approval → inactive V2.8 Draft**. It is NOT a native ChatGPT plugin tool to write directly to Product Hub. A future OAuth authenticated connector could eliminate the copy/paste handoff without breaking the identity boundary.

## ChatGPT payload contract
Only JSON in this shape:
```json
{
 "version": 1,
 "instruction": "วิเคราะห์ราคาจริงและขอปรับเป้าหมายรับซื้อรุ่นที่ตรงกัน",
 "items": [
  {"model": "Exact model existing in Draft", "target_buy": 11000, "hard_max": 12000}
 ]
}
```

For an existing model in the selected Draft, `model` is mandatory and brand/category/model_code/condition are optional **only if exactly one existing entry matches**. Explicit exact values are needed when names overlap. Unspecified price fields are preserved. For a new model, include category, brand, model and all four price fields (estimated_resale, opening_offer, target_buy, hard_max). The parser refuses unknown keys including active/publish/LINE controls, numeric strings, invalid ordering, duplicate identities, batches >20.

## Owner authorization and transaction
Database RPC `ai_buyer_chat_price_apply` is protected with current `auth.uid()` and an active `profiles.role='owner'`. It locks an editable V2.8 Draft, checks the precise existing entry ID, `updated_at` and all four prices against the preview snapshot, and either commits ALL proposed changes or rolls back ALL. It calls the pre-existing audited `ai_buyer_pb28_save_entry` (no change to Active V2.7); writes an additional immutable batch receipt `ai_buyer_chat_price_batches` recording the exact original and updated records, actor, timestamp, and the instruction. Every changed row is marked `active=false` *within the isolated V2.8 Draft* for separate model/spec confirmation.

Existing PriceBook V2.7 and all seven LINE categories' APPROVAL mode are not updated. No LINE send or automatic activation is present. Browsers must never hold service-role credentials. Direct SQL tools with administrative privileges must not impersonate owner approval.

## Verification
- Test owner apply then stale retry in a rollback-only database transaction: stale preview fails.
- Test admin/staff/anon unauthorized call is refused; Owner-only read RLS on batch receipts.
- Frontend tests: ambiguous names, no-op, invalid order, unknown keys, numeric types, multi-row size, preserving unchanged prices, inactive draft.
- Hub CI: TypeScript, build, regression tests; production Hub deploy.
- After deployment: verify Active V2.7 and LINE modes unchanged.

## Operational UX
From this ChatGPT conversation, ask: "เสนอปรับราคาจากต้นทุนและกำไรจริง สำหรับ [ชื่อรุ่น] และสร้าง Chat Price Control JSON ให้ฉัน" then copy the JSON response into Hub's Chat Price Control panel. This saves to a DRAFT only after owner checks all prices in the Hub.

Cost history may be sparse. Do not infer a live quote from one historical purchase; account for damaged hardware, repair costs, stock age, market conditions and margin before proposing a numeric buy price.

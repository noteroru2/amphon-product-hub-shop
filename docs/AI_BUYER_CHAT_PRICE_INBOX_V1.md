# Direct ChatGPT price-change inbox (add-on)

This is an *optional* direct-chat queue layered alongside the existing Chat Price Control JSON paste-and-owner-approve workflow. The original PriceBook V2.8 JSON importer and its atomic approval are preserved. The ChatGPT-connected Supabase administrative tool can submit a PENDING request but **cannot act as the Hub Owner**; only the Hub Owner can approve. Nothing writes V2.7/LINE.

# AMPHON AI Buyer — Chat Price Control V1

## End-to-end owner-approved flow

1. The Owner asks ChatGPT, in natural Thai, to change the buy-price policy for one **existing** PriceBook V2.8 Draft entry. For example: "ตั้ง Lenovo LOQ 15IRX9 i5/RTX3050/16/512 ใน Draft เป้ารับ 11,500 เพดาน 12,500 เปิดรับ 10,500 ขายต่อ 17,000".
2. ChatGPT uses the connected **Supabase** connector to read the exact matching *draft* entry, its four current price fields, condition, and full model/spec identity. If more than one matches, show candidates and let Owner specify an exact SKU. NEVER guess an entry identifier or SKU.
3. ChatGPT presents a **pre-submission price diff** for the proposed amounts. After the user requests a pending change, the assistant can use the connected Supabase server-side SQL tool to enqueue a **PENDING** request. Calls to enqueue cannot modify PriceBook entries. Example:

```sql
-- Execute ONLY in connected protected Supabase service/admin context, NEVER from the public browser.
-- Use the actual matched draft entry UUID and values chosen by the user.
select public.ai_buyer_chat_price_enqueue(
  '<EXACT_EXISTING_DRAFT_ENTRY_UUID>'::uuid,
  '{"estimated_resale":17000,"opening_offer":10500,"target_buy":11500,"hard_max":12500}'::jsonb,
  'Owner-requested adjustment in ChatGPT, inspect current comps before approval',
  'Lenovo LOQ 15IRX9 i5 RTX3050 16/512 — ChatGPT pending review'
);
```

4. ChatGPT reports the returned proposal UUID and **PENDING** status, NOT a completed price change. The Owner opens Hub → AI Buyer → Chat Price Control, confirms the full model, spec/condition, old/new prices, and explicit checkbox, then clicks **Owner อนุมัติบันทึกลง Draft** (or Reject).
5. The server-side PostgreSQL `ai_buyer_chat_price_decide` RPC verifies the caller's Supabase session with `auth.uid()` and an **active owner** in `profiles`. It locks the proposal, draft and row. It atomically verifies status, 48-hour expiry, preview fingerprint, editable DRAFT, exact `updated_at`, and *entire original JSONB row*. It updates only four price fields in `ai_buyer_pb28_entries`, then logs actor + before/after into existing `ai_buyer_pb28_audit` and new `ai_buyer_chat_price_audit`. It NEVER updates an Active V2.7 price-book entry or calls LINE.
6. Rejected, expired or stale proposals are not applicable. Duplicate approval fails. A later price edit causes a stale conflict rather than a silent overwrite.

## Important identity and trust boundaries

**This is direct ChatGPT-to-proposal submission, not direct ChatGPT-to-price activation.** A ChatGPT account or a connected Supabase service credential is NOT proof of the Hub Owner's identity. Only a live Supabase Hub session with Owner authorization can approve a change. The connector merely queues untrusted suggestions. The request's `request_origin='CHATGPT_CONNECTOR'` states transport provenance, not user identity. Never claim a proposal was personally authorized by Owner until the Hub owner RPC successfully commits.

**No service_role keys** in frontend or chat. ChatGPT connector is assumed available only as an already connected protected app. If this connector is unavailable in a future ChatGPT session, chat can prepare the price diff but cannot submit to the DB, and no one should claim a PENDING entry exists.

The `ai_buyer_chat_price_enqueue` function is `SECURITY INVOKER` with EXECUTE revoked from public, anon and authenticated. Only service_role/postgres may enqueue. The `ai_buyer_chat_price_decide` SECURITY DEFINER endpoint has tight Owner JWT authorization, preview equality, row snapshots, and allowed state transitions; EXECUTE is available only to authenticated sessions and checked again inside the function. Tables are RLS owner-read and no direct browser DML. Production requires connection-scoped account permissions and review.

## Scope/limitations

- V1 can update **existing** V2.8 Draft entries only (the Draft already has 47 cloned entries). It cannot insert new models or change identity/condition, cannot activate V2.8, cannot publish to the live AI Worker or LINE, and cannot change V2.7.
- For bulk requests, chat can enqueue multiple one-entry proposals, but each needs an explicit Owner approval in Hub. No implicit all-items apply.
- When chat recommends only one price (e.g. "target buy"), the full four-field proposed tuple must still pass margin/order checks. It may keep the other three prices unchanged only if their numerical order remains valid; show the complete diff.
- No current market price is inferred from an old inventory cost automatically; advise owner to check comparable prices.
- The 48-hour expiry and baseline compare protect against outdated proposals; redraft after expiry or conflict.

## Tests and rollout
- `scripts/verify-ai-buyer-chat-price-control.test.mjs` covers number/order validation, full-record optimistic concurrency, UI diff, and static source restrictions.
- Database rollback transactions verified Owner approval + dual audit, Sales rejection, and optimistic-lock conflict. These tests left zero QA proposals or price edits in Production.
- Verify CI TypeScript and Hub build, then Merge and check production GitHub workflow before claiming deployment.

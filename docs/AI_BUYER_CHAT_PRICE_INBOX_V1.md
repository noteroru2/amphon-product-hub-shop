# Chat Price Control V1.1 — Direct chat proposal inbox (safe owner approval)

This enhancement eliminates the routine JSON copy-and-paste step from ChatGPT to the Hub.

## Chat → Hub flow
1. Owner says in ChatGPT: "ปรับราคา [รุ่น] ...", or "วิเคราะห์ต้นทุน กำไร และเสนอราคารับซื้อ ...". The assistant checks historical cost and sales where accessible, highlights sparse evidence, and asks for explicit numbers if market support is insufficient.
2. Connected authorized Supabase management tool inserts a **PENDING proposal ONLY** into `public.ai_buyer_chat_price_inbox`, with a `version:1` JSON payload containing 1–20 models and an owner-readable summary. The row records `source_label='CHATGPT_ASSISTED'`, **not an authenticated owner action**. No active prices or PriceBook Draft entries change when staging the proposal.
3. Owner signs in to `hub.amphon.co.th`, opens AI Buyer → Chat Price Control and selects the pending suggestion.
4. Owner chooses an editable V2.8 Draft; Hub loads the exact current rows, displays old/new price diff, and requires explicit confirmation.
5. Owner-only `ai_buyer_chat_price_apply_inbox` validates proposal identity/values, current price snapshot/row ID/timestamp, ensures chosen Draft is editable, calls the existing transactional audited save routine and marks the inbox item APPROVED with batch receipt **in one database transaction**. No stale/duplicate approval.
6. Owner can dismiss a pending suggestion without any draft modification.

## Boundary
- No public/anonymous/authenticated direct inserts into inbox are granted. ChatGPT's connected Supabase tool uses admin-managed staging, not owner approval. Only an authenticated current `profiles.role='owner'` may approve through Hub.
- No direct entry to V2.7 ACTIVE or LINE worker. Every saved row in V2.8 DRAFT is forcibly `active=false`.
- For users without a connected authorized staging tool, manual JSON paste remains supported.
- Do NOT send Supabase access tokens, passwords, LINE credentials, client PII, or session cookies in the chat.
- Before staging, distinguish numbers evidenced by real costs/market comparables from prices explicitly provided by the owner.
- Price guidance remains subject to verified hardware specs, condition, repair/warranty costs, stock age and margin; thin historical records cannot justify automatic quotes.

## Chat staging SQL example (admin tool use only; NOT for browser clients)
```sql
insert into public.ai_buyer_chat_price_inbox (proposed_json, instruction)
values (
  '{"version":1,"items":[{"model":"Exact model in Draft","target_buy":12000}]}'::jsonb,
  'Owner instructed to set the target buying price'
)
returning id,status;
```

Important: the example is schema demonstration, not an actual pricing recommendation. Use parameterized inputs or safe SQL literals from the authorized management tool, and never insert an APPROVED row directly.

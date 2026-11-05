# Business Notebook Owner Reduced Price Rules

Owner explicitly confirmed thirteen numeric opening-range rules and one workstation per-model review. The source is the user confirmation in ChatGPT. There is no application of these prices to a live buyer or LINE.

Live staged record: `public.ai_buyer_business_notebook_rule_batches` ID `e8e7fb8f-45f5-41db-b6b3-c4729099d769`, `PENDING`, V2.8 Draft `f087aa6b-06e6-4e00-8d16-c83226032009`.

| CPU | Owner opening offer THB |
|---|---|
| i5 Gen8–9 | 1,500–2,500 |
| i7 Gen8–9 | 2,500–3,500 |
| i5 Gen10 | 2,500–3,500 |
| i7 Gen10 | 3,000–4,500 |
| i5 Gen11 | 3,000–4,500 |
| i7 Gen11 | 4,500–5,500 |
| i5 Gen12 | 4,500–6,000 |
| i7 Gen12 | 6,000–7,500 |
| i5 Gen13 | 6,000–8,000 |
| i7 Gen13 | 7,500–9,500 |
| i5 / Core5 new | 6,500–9,000 |
| Core Ultra5 | 8,000–11,000 |
| Core Ultra7 | 10,000–13,500 |
| ZBook / Precision / ThinkPad P workstation | PER_MODEL, no numeric amount |

Scope: normal-functioning Business Notebook with integrated GPU, charger and tested battery. Owner wants more conservative acquisition prices because Business units can sell more slowly. Check exact CPU, resale and expected spread; exclude dedicated GPU, unknown defects, locks, premium OLED/touch special variants, MacBook, gaming, missing charger, or water damage. Workstations must have model-level review before offering.

Owner-only read via RLS and Owner-only authenticated approve/dismiss RPC sets `APPROVED_DRAFT` with audit. SQL rollback test verified Owner approval and replay refusal; real state remains PENDING.

The UI is isolated under Hub → AI Buyer → Chat Price Control → Business Notebook, separate from 43 Office Notebook price groups and 10 Gaming Notebook groups. No changes to Active V2.7 / V2.8 price rows or LINE AUTO; this draft table is not hooked into the AI Buyer worker.

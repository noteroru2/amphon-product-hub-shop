# AI Buyer conditional opening-price proposal — owner chat (2026-11-04)

Owner instruction: "ถ้าเป็นโน๊ตบุ๊คเกมมิ่ง i5gen10 gtx1650 ram 8 หรือ 16 ssd 512 ทุกรุ่น เราเสนอ 7000-8000 บาท ก่อนเลย"

Staged pending proposal ID: `953444fd-b891-4f57-8cf9-46cff5eae9a8`.

- Applies to gaming NOTEBOOK devices across brands with Intel Core i5 10th generation, **GTX 1650** non-Ti, RAM 8 or 16 GB, and SSD 512 GB; normal functional condition only.
- **Initial offer range** THB 7,000–8,000, not final target buy, hard ceiling or market resale.
- Excludes GTX 1650 Ti, desktops, different CPU generation, wrong SSD capacity, defective hardware, unknown/misidentified specs. Damaged items require a separate inspection/quote; the system must not infer a good condition from a product title.
- Historical purchase snapshots had several comparable ASUS/MSI/Lenovo gaming items, but only limited individual sale outcomes. This rule originates **from the owner**, not a claim that machine learning discovered the price.
- Supabase `ai_buyer_chat_offer_rules` stores pending conditions and range; Owner Hub Chat Price Control displays it and permits explicit DRAFT rule approval or dismissal through `ai_buyer_chat_offer_rule_decide`. Approval only changes policy status to APPROVED_DRAFT. **It does not update active V2.7, V2.8 price entry rows, or LINE/Worker**.
- When future worker integration is developed, separately verify exact hardware-spec match, cost margin, hard cap, market age, and active-price rollout with owner approval before any offer is sent.

This design avoids encoding a cross-model policy as a fake single product in PriceBook V2.8.

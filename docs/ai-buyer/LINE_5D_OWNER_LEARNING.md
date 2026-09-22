# AI Buyer — LINE 5-Day Owner Learning Capture

Window: **2026-09-22 18:00 → 2026-09-27 18:00 Asia/Bangkok**

## Objective

Collect a high-quality corpus of real customer conversations while the AI Buyer remains paused, then learn:

- actual owner buy-price behavior,
- opening / target / accepted price patterns,
- condition and defect deductions,
- negotiation language,
- objection handling,
- closing patterns,
- cases that should be rejected or handed to an admin.

The final outputs after the window are:

1. **AMPHON BookPrice candidate version**
2. **Owner Conversation Playbook**
3. **Regression fixtures from successful and failed negotiations**
4. **Confidence / Human Review rules**

## Live collection during the five days

Customer messages continue through the existing LINE webhook and are stored in:

- `ai_buyer_webhook_events`
- `ai_buyer_messages`
- `ai_buyer_case_images`

A database trigger copies each message inside the learning window to
`ai_buyer_learning_events` so the learning corpus is frozen independently from case-state changes.

No OpenAI call is required for capture.

## Manual owner replies

LINE Messaging API webhooks expose events when a user sends a message to the Official Account.
They do **not** provide the text body of messages manually sent from the LINE Official Account Manager chat screen.

Therefore manual owner replies are recovered from the LINE OA chat-history backup/export after the capture window.

Raw exports are registered in `ai_buyer_learning_imports`, then normalized into
`ai_buyer_learning_events` with source `LINE_OA_CHAT_EXPORT`.

The importer function is:

`ai_buyer_import_line_chat_records(window_id, import_id, rows_json)`

Raw rows are preserved for auditability.

## Daily completeness audit

GitHub Actions workflow:

`.github/workflows/ai-buyer-line-learning-capture.yml`

runs every day at 00:20 Asia/Bangkok and calls LINE message-delivery insights for the previous day.
The `chat` count is stored in `ai_buyer_learning_line_delivery_stats`.

This does not contain message text. It is a completeness check used to compare the number of manual
LINE OA Manager messages against the later CSV import.

## Privacy before learning

Raw conversation evidence remains restricted to service-role access.
Before any AI-based corpus analysis:

- redact phone numbers,
- redact bank-account numbers,
- redact addresses that are not needed for fulfillment analysis,
- redact other unnecessary identifiers.

Product/model/spec/condition/price and conversation sequence are retained.

## Day-5 processing

1. Close the learning window.
2. Import the LINE OA chat-history CSV.
3. Reconcile manual outbound count against daily `chat` insight totals.
4. Merge inbound webhook events + manual outbound export into ordered conversations.
5. Remove non-valuation conversations.
6. Redact PII.
7. Extract product facts / condition / asking price / owner opening / counteroffers / accepted price.
8. Label successful vs unsuccessful closing sequences.
9. Produce BookPrice candidate rows:
   - estimated_resale
   - opening_offer
   - target_buy
   - hard_max
   - condition deductions
   - evidence count
   - confidence
10. Produce Owner Conversation Playbook.
11. Replay against the regression suite.
12. Keep AI production paused until explicit owner approval.

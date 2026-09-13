# HUB-2 — MOBILE ONE-TAP PRODUCT IMAGE EXPORT REPORT

Date: 2026-09-13 (Asia/Bangkok)  
Verdict: **PASS_WITH_OWNER_DEVICE_VERIFICATION_REQUIRED**

## 1. Root cause and previous behavior

Product Hub already had native file sharing and ZIP export, but `shareProductImages()` fetched every remote image only after the employee tapped “แชร์รูป”. On mobile Safari, the asynchronous fetch sequence could outlive transient user activation before `navigator.share()` was called. It also included title/text with the files, which could encourage the OS to treat the action as a generic share rather than a files-only image save. Employees therefore could not rely on a true one-tap “prepare first, share immediately” workflow.

## 2. New employee workflow

When a product screen or Publish Center product sheet opens, Hub now prepares its uploaded product images in the background without blocking initial rendering:

1. UI shows `กำลังเตรียมรูป X/N...`.
2. Original image responses are fetched in product image order and converted to `File` objects.
3. Hub checks `navigator.canShare({ files })`.
4. The primary button becomes `บันทึกรูปทั้งหมด (N)` only when all files are ready.
5. One employee tap invokes `navigator.share({ files })` immediately with files only.
6. The mobile OS owns the final Share Sheet / Save Images confirmation.

The web application does not claim or attempt to write silently to iOS Photos.

## 3. Mobile implementation and user activation

- Reusable `ProductImageExportActions` is integrated in the Product Sales Toolkit and Publish Center product sheet.
- `useProductImageExport` starts preparation on screen load and retains exactly one prepared file set for the visible product.
- The click handler performs no image fetch before `navigator.share`; it calls the prepared-files share function immediately.
- `navigator.share` and `navigator.canShare` are both capability-checked.
- Share payload is `{ files }` only—no title, text, URL, token, or private data.
- Closing the native Share Sheet with `AbortError` is treated as cancellation, not an application failure.
- A non-cancellation share failure is shown as a recoverable employee message.

## 4. Image preparation, quality, ordering, and filenames

- Source: existing `ProductImageDraft.publicUrl`, which points to the full R2-backed `/image/products/...` object response used by Hub/SHOP, not a thumbnail or screenshot.
- MIME type is validated as `image/*` and preserved on each `File`.
- Extensions are derived from the response MIME type with URL extension fallback.
- Files keep ascending product `order`.
- Stable filenames: `<sanitized-SKU>-01.jpg`, `<sanitized-SKU>-02.jpg`, etc.
- Current product schema/UI limits a product to 20 images; export applies the same maximum.
- Each transient image fetch is retried once; manual retry remains available after a preparation error.

## 5. CORS and authentication result

Production verification fetched a real image with `Origin: https://hub.amphon.co.th` and received an HTTP-successful original image response with an image MIME type and an allowed CORS response. Product image GET is already the established public immutable object route used by public SHOP listings, so Hub sends no session token or cookie (`credentials: 'omit'`) during export.

No CORS rule was broadened and the API Worker was not changed or deployed. Authenticated API CORS remains restricted to the configured Hub, legacy app, and SHOP origins. `shop.amphon.co.th` behavior was not changed.

## 6. Fallback behavior

Fallback order is now explicit:

1. Native multi-file Share Sheet: `บันทึกรูปทั้งหมด (N)`.
2. Unsupported native multi-file share or oversized share set: `ดาวน์โหลดรูปทั้งหมดเป็น ZIP`.
3. Expandable `ดาวน์โหลดทีละรูป` controls remain available.

ZIP uses the same original image preparation path and retains the existing spec/content text files. It does not trigger uncontrolled automatic multiple downloads.

## 7. Memory and stale-product safeguards

- Native-share preparation limit: 200 MiB total.
- ZIP preparation limit: 500 MiB total.
- Per-image limit: 50 MiB.
- At most 20 ordered remote images are retained.
- Preparation is sequential to avoid concurrent high-resolution memory spikes.
- No object URLs are created for native sharing.
- Temporary download/ZIP object URLs are revoked after use.
- `AbortController` cancels preparation when the component unmounts or product signature changes.
- A prepared product signature is checked again at click time so stale Product A files cannot be shared after switching to Product B.
- Duplicate preparation jobs are not intentionally started; retry increments a bounded preparation attempt and aborts the prior one.

## 8. Error handling

The implementation distinguishes no uploaded images, failed HTTP/CORS fetch, invalid/non-image response, empty image, excessive image/set size, unsupported file sharing, stale product data, native share error, and user cancellation. Progress and errors use employee-facing Thai text without exposing Blob, credentials, tokens, or internal storage paths.

## 9. Files changed

- `src/lib/productImageExport.ts` — ordered original-image preparation, limits, retry, validation, files-only share, individual download.
- `src/hooks/useProductImageExport.ts` — background preparation lifecycle, progress, abort, product signature, retry, readiness.
- `src/components/ProductImageExportActions.tsx` — one-tap mobile UI and fallbacks.
- `src/lib/sales.ts` — ZIP now reuses the validated original-file preparation path.
- `src/App.tsx` — Product Sales Toolkit integration.
- `src/components/PublishCenter.tsx` — Publish Center integration.
- `src/styles/app.css` — prominent responsive touch controls and status UI.
- `scripts/verify-hub2.mjs` — static/live safety verifier.
- `package.json` — `verify:hub2` command.
- `HUB2_MOBILE_IMAGE_EXPORT_REPORT.md` — this report.

## 10. QA and regression results

| Check | Result |
|---|---|
| TypeScript typecheck | PASS |
| Hub production build | PASS |
| HUB-1 verifier | PASS |
| HUB-1 live verifier | PASS |
| HUB-2 verifier | PASS |
| Hub bulk-image button/count/progress | PASS |
| Prepared files before click | PASS |
| `canShare({ files })` guard | PASS |
| Files-only `navigator.share({ files })` | PASS |
| SKU filenames/order/MIME | PASS |
| Retry/cancel/abort/stale-product safety | PASS |
| ZIP and individual fallbacks | PASS |
| Production image fetch/CORS | PASS |
| SHOP build | PASS — 0 errors, 4 existing hints |
| SHOP-6.2 regression | PASS |
| Production closeout regression | PASS |
| Secret scan | PASS |
| `purchase_enabled` unchanged | PASS — remains `true` |
| PromptPay unchanged | PASS — remains disabled |

The Vite main Hub bundle remains above the 500 kB advisory threshold; HUB-2 adds a small workflow to the existing bundle and does not reopen broad performance work.

## 11. Browser and device QA

- Desktop/browser smoke: deployed Hub HTTP 200, canonical login shell loads, and the deployed JS asset contains all HUB-2 states and controls.
- Authenticated product UI could not be exercised in Codex's browser because no employee session was available; credentials were not requested or automated.
- iPhone/iPad Safari Share Sheet, `Save N Images`, Photos count/order, and Android Chrome multi-file receiving app cannot be marked PASS from desktop automation.

Status: **OWNER_DEVICE_VERIFICATION_REQUIRED**

### iPhone/iPad Safari owner check

1. Sign in to `https://hub.amphon.co.th`.
2. Open a real product containing multiple uploaded images.
3. Wait for `บันทึกรูปทั้งหมด (N)`.
4. Tap once and confirm the native Share Sheet contains all N images.
5. Choose `Save N Images` (or the localized equivalent).
6. Confirm N separate, full-quality images appear in Photos in the expected order.
7. Confirm the files/images belong to the currently visible SKU.

### Android Chrome owner check

1. Open the same real product and wait for readiness.
2. Tap the bulk-save button once.
3. Confirm the native share flow receives all files.
4. If multi-file sharing is unavailable, confirm ZIP is offered and individual downloads remain accessible.

## 12. Production deployment

- Service: `amphon-product-hub`
- Platform: Cloudflare Workers Static Assets
- Custom domain: `hub.amphon.co.th`
- Version ID: `8ba5b58c-90d0-495c-9530-762033014c20`
- Deployed assets: Hub HTML, JS, CSS, and service worker only.
- API Worker deployment: not required / not performed.
- SHOP deployment: not performed.
- Orders, checkout, Stripe, webhook, PromptPay, shipping, returns, commerce settings, and publication behavior: unchanged.

## 13. Remaining warnings

- Native OS integration still requires the owner device checks above.
- Installed/PWA users may need to close/reopen or refresh once while the auto-updating service worker activates the new asset set.
- Extremely large image sets intentionally fall back to ZIP instead of degrading image quality.

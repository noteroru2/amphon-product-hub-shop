# Batch 3.5 — QR / Barcode Workflow Report

Status: `IMPLEMENTED_WITH_ENVIRONMENT_WARNING`

## Implemented

- SKU QR deep links (`?sku=...`)
- Code128 SKU barcode generation
- Mobile scanner screen in bottom navigation
- ZXing live camera scan for QR and common barcode formats
- Scan barcode/QR from a captured or selected image
- Manual SKU / Serial fallback search
- Scan result opens exact existing Product Hub item
- External phone-camera QR deep-link resolution after authentication
- Product quick actions: Edit, Reserve, Sold
- Quick status actions reuse Batch 3.3 transition guards
- Quick status actions are written to the product activity log
- Warranty summary in the QR workflow card
- 70×40 mm and 50×30 mm printable product labels
- Download QR PNG
- Download Code128 PNG
- Copy product deep link
- No financial/cost data is encoded in QR or barcode

## Deployment impact

- Supabase migration: **NO**
- R2 bucket change: **NO**
- Cloudflare Worker redeploy: **NO**
- Existing `.env`: **REUSE + add optional `VITE_PUBLIC_APP_URL` for permanent QR labels**
- Frontend `npm install`: **YES**, because new scanner/code-generation dependencies were added

## Dependencies added

- `@zxing/browser` 0.1.x + `@zxing/library` 0.21.x (Node 22 compatible)
- `qrcode` 1.5.x
- `@types/qrcode` 1.5.x
- `jsbarcode` 3.12.x

## Security / workflow decisions

- QR encodes only the Product Hub deep link containing SKU; it does not encode cost, employee data or Supabase credentials.
- Code128 contains only the SKU.
- Reserve/Sold quick actions still pass the same application/database status transition guards introduced in Batch 3.3.
- A normal phone-camera deep link still requires Product Hub authentication before inventory data is shown.

## Mobile note

Live camera scanning uses `getUserMedia`, which requires HTTPS/secure context on mobile browsers. The app includes image-scan and manual-search fallbacks for LAN testing over plain HTTP.

## Verification in this environment

- TS/TSX syntax transpile audit: PASS
- QR/Barcode workflow presence audit: PASS
- `npm install` / dependency-resolved TypeScript build: not completed because this execution environment timed out while reaching the npm registry.

Final gate on the deployment machine:

```powershell
npm install
npm run typecheck
npm run build
npm run dev
```

# Batch 3.1 — Content Template

Status: IMPLEMENTED

## Added
- Content templates: Facebook, Facebook Marketplace, WINNER IT, Generic/LINE
- Mobile channel tabs inside Sales Toolkit
- Live preview per channel
- One-tap copy for the selected channel
- ZIP now contains content-facebook.txt, content-marketplace.txt, content-winner-it.txt, content-generic.txt, spec.txt and the original sales-content.txt compatibility file
- No product cost is included in copied/exported content
- Templates are centralized in `src/lib/contentTemplates.ts` for easy future editing

## Deployment
No Supabase schema changes and no Worker changes are required. Keep the same `.env`. Run `npm install`, `npm run typecheck`, `npm run build`.

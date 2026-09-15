# ONE-2C — Product Hub Enrichment Workflow

Status: `SOURCE_READY / PRODUCTION_ACTIVATION_PENDING`

ONE-2C turns a System-created Product Shell into an operational enrichment queue without adding a Technical Inspection or QC stage.

## Operating principle

Every item still starts in AMPHON System. The existing System intake/buyback workflow is unchanged.

After ONE-2B creates the matching Product Hub shell, Hub staff may enrich the same SKU later and in any order:

```text
AMPHON System Intake
  -> Product Shell (same immutable SKU / QR)
  -> Photos
  -> Specs
  -> Listing content
  -> READY_TO_LIST
```

Photos, specs and listing content are independent. Different employees may complete them on different days. Scanning/opening the existing SKU must always edit the existing Product Hub product; enrichment never creates a replacement identity.

There is no `QC_PENDING` and no Technical Inspection step in ONE-2C.

## Workstreams

### Photos

`one_photos_complete` is calculated automatically from saved Product Hub images.

Operational default:
- at least 2 saved product images
- at least one image marked as cover

The rule is intentionally simple for shop throughput. Adding/removing images may move the product in or out of photo-complete automatically.

### Specs

`one_specs_complete` is category/subtype aware and uses the required fields already represented by Product Hub product schemas.

Examples:
- Notebook: CPU + RAM + SSD
- Gaming/workstation PC: CPU + mainboard + RAM + SSD + GPU
- iPhone: storage + Face ID + screen condition + repair history
- Camera: shutter count/unknown + sensor condition
- Lens: mount + focal length + aperture + autofocus + glass/optics condition
- Monitor: size + resolution + refresh rate + pixel result

Serial/IMEI is not a listing-readiness requirement. UNKNOWN serial from intake can therefore be completed later without changing product identity.

### Listing content

`one_listing_content_complete` requires:
- category
- subtype
- brand
- model
- title
- selling price greater than zero

This is separate from the spec workstream, so a sales employee can complete listing content independently from the employee entering technical specs.

## Derived readiness

AMPHON ONE uses the independent flags as the authoritative preparation state:

```text
INTAKE_ONLY
PHOTO_PENDING
SPEC_PENDING
LISTING_CONTENT_PENDING
READY_TO_LIST
```

`READY_TO_LIST` means:

```text
one_photos_complete
&& one_specs_complete
&& one_listing_content_complete
```

For compatibility with the existing Hub and Publish Center, ONE-managed products that become fully ready are also moved to legacy `status=ready_to_list` when the current legacy status is a preparation status.

If required enrichment becomes incomplete later, a preparation-status product is moved out of `ready_to_list`. Existing business lifecycle statuses such as published, reserved, sold, repair, consignment, returned and cancelled are not silently overwritten by ONE-2C.

## Battery health

Battery percentage is not required.

Canonical values:

| Value | Thai UI |
| --- | --- |
| `LOW` | ต่ำ |
| `GOOD` | ดี |
| `VERY_GOOD` | ดีมาก |
| `UNKNOWN` | ไม่ทราบ |

The queue offers the simple grade only for product categories/subtypes where a rechargeable battery is operationally relevant.

## Employee workflow

The Hub UI includes `EnrichmentQueueDock`, protected by:

```text
VITE_ONE2C_ENRICHMENT_ENABLED=false
```

Default is OFF.

When activated after migration it shows counts for:
- received / not started
- missing photos
- specs incomplete
- listing content incomplete
- ready to list

Selecting a queue item opens the existing product by SKU using the same `?sku=` flow already used by Hub QR/deep-link handling.

## Audit and event flow

Readiness changes are written to existing Product Hub activity logs. ONE-2C records completion timestamps for each workstream.

Meaningful changes enqueue a server-side transactional Outbox event:

```text
product.enrichment_changed
```

Destination:

```text
amphon-system
```

Payload contains only the product identity/readiness projection needed by System:
- Hub Product UUID
- SKU
- listing readiness
- photo complete
- specs complete
- listing-content complete
- battery grade

The browser cannot write Integration Outbox rows directly; those are produced by database trigger logic.

## Production activation order

Do not enable ONE-2C UI before the database migrations exist.

Recommended ONE-PROD order:

1. Back up/verify databases.
2. Deploy/verify System ONE-1 + ONE-2A migrations.
3. Apply Hub ONE-2B Product Shell migration.
4. Apply Hub ONE-2C Enrichment migration.
5. Deploy Product Hub frontend with `VITE_ONE2C_ENRICHMENT_ENABLED=false`.
6. Deploy/verify Bridge and matching secrets.
7. Enable ONE-2A and ONE-2B with one controlled intake item.
8. Verify Product Shell mapping/SKU.
9. Add specs first and verify photo work remains independent.
10. Add photos later and verify spec completion remains intact.
11. Complete listing content and verify `READY_TO_LIST`.
12. Remove a required item/photo and verify readiness can regress safely.
13. Verify activity history and `product.enrichment_changed` Outbox rows.
14. Enable `VITE_ONE2C_ENRICHMENT_ENABLED=true`.
15. Verify mobile QR/SKU open and queue counts.

## Current activation state

No ONE-2C production migration or frontend activation is performed by this source batch. Runtime acceptance remains deferred to ONE-PROD.

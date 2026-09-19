# AMPHON Channel Architecture

Status: implemented foundation. This layer lets Product Hub treat Website, Facebook and Shopee as replaceable channel adapters without changing the inventory authority.

## Authority

1. **AMPHON System** owns physical stock, reservation and final sale state.
2. **AMPHON Product Hub** owns product enrichment, listing content, images and channel orchestration.
3. **AMPHON SHOP / Website** is a native sales projection.
4. **Facebook Page / Marketplace** are assisted channels today. Hub prepares content/images; staff performs the external publish/close action.
5. **Shopee** runs in assisted mode while direct Seller API access is unavailable. Hub prepares title, images, SKU, suggested category, stock guidance and a channel price at +18–20% from the Hub price; staff publishes manually in Seller Centre. It can later switch to direct API or an approved partner without changing Product Master.

No external channel may become stock master.

## Stable channel keys

- `website`
- `facebook_page`
- `facebook_marketplace`
- `shopee`

Legacy `product_publications` names (`website`, `facebook`, `marketplace`) remain compatible. They are not renamed in this release.

## Adapter modes

- `native`: AMPHON owns the publisher end-to-end. Website uses this.
- `assisted`: Hub prepares a complete publish package; a person performs the final external action. Facebook uses this now.
- `direct_api`: server-side channel API integration. Reserved for Shopee when valid Open Platform credentials are available.
- `partner_api`: future ERP / approved partner connector.
- `disabled`: adapter is installed but must not publish.

A channel can change adapter mode without changing SKU, Product Master or AMPHON System stock logic.

## Canonical flow

```text
AMPHON System
  stock / reservation / sale authority
          |
          v
AMPHON Product Hub
  Product Master + images + content + readiness
          |
          v
Channel Orchestrator
  +-- Website adapter ----------> AMPHON SHOP
  +-- Facebook Page adapter ----> assisted package now / API later
  +-- Marketplace adapter ------> assisted package now / API later
  +-- Shopee adapter -----------> assisted Seller Centre now / direct or partner later
```

## Channel contract

Every adapter must be able to describe these capabilities:

- publish
- update content
- update price
- project stock
- end/unlist
- receive orders/events
- automatic vs assisted execution

The orchestrator must fail closed when a capability is unavailable.

## One-of-one stock rule

Used inventory is normally one physical unit.

- `IN_STOCK` -> channel stock projection may be `1`
- every other AMPHON System availability -> channel stock projection is `0`

RESERVED and SOLD must never be turned back into channel stock by a marketplace event. Any order from an external channel must be converted into a command toward AMPHON System; the channel itself never finalizes canonical stock.

## Current execution policy

| Channel | Mode | Auto publish | Stock authority |
| --- | --- | --- | --- |
| Website | native | yes | AMPHON System |
| Facebook Page | assisted | no | AMPHON System |
| Facebook Marketplace | assisted | no | AMPHON System |
| Shopee | assisted | no | AMPHON System |

Shopee direct runtime already exists behind the adapter boundary, but production does not require Shopee credentials while the seller account is ineligible for direct API access. The assisted workflow defaults to +20% pricing, allows staff to choose +18%, +19% or +20%, and rounds the resulting listing price upward to the next 10 THB. This is a store pricing policy, not an automatic calculation of Shopee fees or campaign costs.

## Future Shopee partner path

When an approved middleware is selected, set Shopee to `partner_api` and add a partner adapter implementing the same contract:

```text
Hub -> Channel Orchestrator -> ShopeePartnerAdapter -> partner API -> Shopee
```

The rest of Product Hub does not change.

## Facebook path

For now the Facebook adapters remain assisted. Hub continues to generate Facebook/Marketplace content and images. If Meta access is added later, replace only the adapter implementation and keep the channel key stable.

## Database foundation

`sales_channel_registry` stores channel mode/capability policy.

`sales_channel_links` is the generic external-listing identity layer for future adapters. Existing Website and Shopee tables remain authoritative for their current runtimes until an adapter is migrated.

`sales_channel_jobs` is a generic durable queue for future adapter work. Writes are service-role only.

## Go-live invariants

- No browser holds marketplace secrets.
- No channel may set canonical physical stock.
- Automated publishers must be idempotent.
- Missing credentials/mapping/capability must fail closed.
- SOLD/RESERVED projects zero stock.
- Direct Shopee API remains disabled unless explicitly enabled with valid credentials; assisted/manual Shopee publishing never enqueues the direct API queue.

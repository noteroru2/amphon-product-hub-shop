# SHOP-8 — Customer Membership Architecture

Status: `SHOP-8.0 ARCHITECTURE READY / DB MIGRATION STAGED`

Production storefront: `https://shop.amphon.co.th`

This document is the architecture contract for SHOP-8. It does not itself enable member-required checkout.

## Product decision

Before a customer can create a purchase order, the customer must be authenticated as a SHOP member.

Supported sign-in methods only:

1. Email + Password
2. Google

Not supported:

- Facebook Login
- LINE Login
- anonymous checkout after SHOP-8.5 activation

A guest may browse products and build a cart before authentication. The cart must survive login/sign-up and return the customer to checkout.

## Critical security separation: staff vs customer

AMPHON Product Hub already uses Supabase Auth and `public.profiles` for staff roles:

- owner
- admin
- sales
- technician

Before SHOP-8.0, the `on_auth_user_created` trigger created a `public.profiles` row with role `sales` for every new Auth user. That behavior is safe only while Auth users are staff-only. It is unsafe once public customer sign-up exists.

SHOP-8.0 changes the identity contract:

- normal new Auth user => SHOP customer
- future staff user => staff only when server-controlled `raw_app_meta_data.account_type = 'staff'`
- staff role comes only from server-controlled app metadata
- customer-controlled `raw_user_meta_data` must never grant a staff role
- existing `public.profiles` rows remain staff and are preserved

Production Hub currently has public signup disabled. Keep it disabled.

## Database ownership model

### `commerce_customer_profiles`

One row per customer identity.

Key fields:

- `id` — stable SHOP customer id
- `auth_user_id` — unique FK to Supabase `auth.users`
- `email` — synchronized from verified Auth state
- `display_name`
- `phone`
- `email_verified_at`
- `auth_provider`
- `status` (`ACTIVE` / `DISABLED`)

RLS contract:

- authenticated customer can read only their own profile
- customer may update only safe profile columns (`display_name`, `phone`)
- email/provider/status remain server-owned

### `commerce_customer_addresses`

Thailand address book owned by a customer.

Required shipping fields:

- label (บ้าน / ที่ทำงาน / custom)
- recipient name
- phone
- address line 1
- optional address line 2
- subdistrict / แขวง
- district / เขต
- province
- 5-digit postal code
- country `TH`
- default-address flag

Multiple addresses are supported. Only one active default address may exist per customer.

## Order identity model

Existing historical and currently-created guest orders must remain valid.

SHOP-8.0 therefore adds nullable fields to `commerce_orders`:

- `customer_id`
- `auth_user_id`
- `customer_profile_snapshot`
- `shipping_address_snapshot`

The existing columns such as customer name, phone, email, address, district, province and postal code remain for backward compatibility.

When member checkout is activated later, every new order will bind to the verified Auth user and customer profile.

### Immutable snapshot rule

Never render a historical order from the customer's current mutable profile/address.

At order creation, snapshot customer and shipping data into the order. If the customer edits an address later, an old order must remain unchanged.

For `PICKUP`, shipping address snapshot may be null, but customer identity/contact snapshot is still required.

## Guest-order history

Do not automatically attach historical guest orders to a new member merely because a typed checkout email string matches an account email.

Any historical linking flow must use verified identity and an explicit controlled migration/admin workflow.

Plain typed-email matching alone is not sufficient proof of ownership.

## Staged activation flag

`commerce_store_settings.member_checkout_required`

SHOP-8.0 value: `false`

It stays false until SHOP-8.5 passes production acceptance.

This allows the schema to be installed without breaking the current live checkout.

## Frontend route plan

Planned routes:

- `/account/login/`
- `/account/signup/`
- `/auth/callback/`
- `/account/`
- `/account/addresses/`
- `/account/orders/`

Authentication redirects may use a `returnTo` path, but it must be restricted to same-origin relative routes to prevent open redirects.

## Auth provider plan

### Email + Password

SHOP-8.1:

- sign up
- email verification
- sign in
- sign out
- forgot password
- reset password

Email verification is required before checkout identity can be considered purchase-ready.

### Google

SHOP-8.2:

- Google OAuth through Supabase Auth
- callback only to approved `shop.amphon.co.th` URL(s)
- no Facebook provider
- no LINE provider

## Store API boundary

The browser must never send a trusted `customer_id` or `auth_user_id` and expect the server to accept it.

Future authenticated Store API requests will send:

`Authorization: Bearer <Supabase access token>`

The API Worker must verify the token against Supabase Auth, derive the Auth user id/email server-side, then resolve `commerce_customer_profiles` itself.

The current public Store CORS contract allows only `content-type`; SHOP-8.1 must add `authorization` before authenticated Store API calls are enabled.

No Supabase secret/service-role key is ever exposed to the Shop browser.

## Member checkout contract (SHOP-8.5)

When `member_checkout_required = true`:

1. Browser submits authenticated Bearer token.
2. Worker verifies token.
3. Worker loads active customer profile.
4. For SHIPPING, client submits a selected `addressId`.
5. Worker verifies address ownership and loads it server-side.
6. Worker constructs canonical customer/address snapshots.
7. Order RPC receives verified identity values from Worker, not arbitrary browser identity fields.
8. Order stores `customer_id`, `auth_user_id`, profile snapshot and shipping snapshot atomically with reservation creation.
9. Cart clears only after successful order creation, preserving existing idempotency semantics.

For PICKUP, full shipping address is not required, but customer profile name/phone remains required.

## My Orders contract

Customer browsers do not receive direct `SELECT` privileges on `commerce_orders`.

`commerce_orders`, payments, documents and warranties remain server-only.

Future `/store/customer/orders` APIs must:

- verify Bearer token
- derive `auth_user_id`
- query via trusted Worker/service role
- filter strictly to that verified user/customer
- never accept arbitrary `customer_id` as authorization

## Payment safety

SHOP-8 does not change payment-provider activation.

Current production contract remains:

- purchase enabled: ON
- Stripe card: ON
- PromptPay: OFF until separate SHOP-9 acceptance

Do not enable PromptPay as a side effect of customer membership work.

Do not create a real order/payment for automated verification.

## Deployment safety

The SHOP Git auto-deploy pipeline deploys `shop/**` changes.

Supabase migrations remain manual/controlled and must never be executed by Cloudflare build commands.

The migration staged by SHOP-8.0 is:

`supabase/migrations/20260913230000_shop80_customer_identity_architecture.sql`

Read-only post-apply assertions:

`supabase/SHOP80_ACCEPTANCE_ASSERT.sql`

## Phase plan

### SHOP-8.0 — Customer Identity Architecture

- staff/customer privilege separation
- customer profile schema
- Thai address schema
- nullable order ownership/snapshot schema
- staged member-checkout feature flag
- RLS contract
- no live checkout enforcement

### SHOP-8.1 — Email Signup / Login

- Shop Supabase browser auth adapter
- login/signup UI
- email verification
- password reset
- session UI
- Store API Bearer-token verification foundation

### SHOP-8.2 — Google Login

- Google OAuth
- callback/redirect validation
- account/session normalization

### SHOP-8.3 — Customer Profile

- profile page
- name/phone
- verified-email display
- account logout/session UX

### SHOP-8.4 — Thai Shipping Address Book

- CRUD addresses
- Thai validation
- multiple addresses
- atomic default-address selection

### SHOP-8.5 — Member-required Checkout

- preserve cart across auth
- require verified customer before order creation
- selected-address ownership validation
- identity/address snapshots
- bind orders to Auth/customer
- production feature flag activation only after E2E acceptance

### SHOP-8.6 — My Orders / Receipt / Warranty

- authenticated order history
- order detail
- receipt/document access
- warranty access

### SHOP-8.7 — Security / RLS / Production Acceptance

- cross-account access tests
- privilege escalation tests
- expired/revoked session tests
- OAuth redirect tests
- member checkout E2E
- legacy guest-order regression
- production acceptance

## SHOP-8.0 acceptance gate

SHOP-8.0 is architecture-ready when:

- customer tables are defined
- RLS is self-only
- normal new Auth users no longer become staff
- order identity/snapshot columns are nullable and backward-compatible
- `member_checkout_required` exists and remains false
- direct customer access to `commerce_orders` remains blocked
- Stripe/PromptPay/purchase activation logic is unchanged
- migration is staged but not silently applied

Final SHOP-8.0 production behavior must remain identical until the migration is explicitly applied and later phases activate member checkout.

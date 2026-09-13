import { readFile } from 'node:fs/promises'

const readShop = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const readRoot = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const [cart, auth, checkoutMember, checkout, login, signup, migration] = await Promise.all([
  readShop('src/lib/cart.ts'),
  readShop('src/lib/customer-auth.ts'),
  readShop('src/lib/checkout-member.ts'),
  readShop('src/pages/checkout/index.astro'),
  readShop('src/pages/account/login.astro'),
  readShop('src/pages/account/signup.astro'),
  readRoot('supabase/migrations/20260913210000_shop84_member_checkout_identity_bridge.sql'),
])

const checks = [
  ['cart persists in localStorage', cart.includes("CART_STORAGE_KEY = 'amphon_shop_cart_v1'") && cart.includes('localStorage.setItem')],
  ['auth does not clear cart', !auth.includes('amphon_shop_cart_v1') && !auth.includes('clearCart(')],
  ['login carries safe next path', login.includes("safeNextPath(new URLSearchParams(location.search).get('next'))") && login.includes('startGoogleSignIn(next)')],
  ['signup carries safe next path', signup.includes("safeNextPath(new URLSearchParams(location.search).get('next'))") && signup.includes('startGoogleSignIn(next)')],
  ['checkout member state bridge', checkout.includes('loadCheckoutMemberState') && checkout.includes('member-address-select')],
  ['checkout identity attach', checkout.includes('attachCustomerCheckoutIdentity(idempotencyKey, addressId)')],
  ['member attach occurs before cart clear', checkout.indexOf('attachCustomerCheckoutIdentity(idempotencyKey, addressId)') !== -1 && checkout.indexOf('clearCart();') > checkout.indexOf('attachCustomerCheckoutIdentity(idempotencyKey, addressId)')],
  ['guest login returns checkout', checkout.includes('/account/login/?next=%2Fcheckout%2F') && checkout.includes('/account/signup/?next=%2Fcheckout%2F')],
  ['bridge uses authenticated JWT only', checkoutMember.includes('getValidCustomerSession') && checkoutMember.includes('authorization: `Bearer ${session.access_token}`')],
  ['bridge RPC requires auth uid', migration.includes('actor_id uuid := auth.uid()') && migration.includes("raise exception 'AUTH_REQUIRED'")],
  ['bridge prevents unrelated order claim', migration.includes("raise exception 'ORDER_EMAIL_MISMATCH'") && migration.includes("raise exception 'ORDER_ALREADY_OWNED'")],
  ['bridge limits fresh checkout window', migration.includes("interval '30 minutes'")],
  ['trusted DB snapshots', migration.includes('customer_profile_snapshot = customer_snapshot') && migration.includes('shipping_address_snapshot = address_snapshot')],
  ['SHOP-8.4 does not enable member enforcement', !migration.match(/update\s+public\.commerce_store_settings[\s\S]*member_checkout_required/i)],
]

for (const [label, ok] of checks) {
  if (!ok) throw new Error(`SHOP-8.4 FAIL: ${label}`)
}

const browserSources = [checkoutMember, checkout].join('\n')
for (const forbidden of ['SUPABASE_SECRET_KEY', 'SERVICE_ROLE', 'service_role', 'sb_secret_', 'STRIPE_SECRET_KEY']) {
  if (browserSources.includes(forbidden)) throw new Error(`SHOP-8.4 FAIL: forbidden browser credential marker ${forbidden}`)
}

console.log('SHOP-8.4 VERIFY PASS')

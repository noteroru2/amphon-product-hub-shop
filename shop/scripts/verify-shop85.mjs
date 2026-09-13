import { readFile } from 'node:fs/promises'

const files = {
  checkout: await readFile(new URL('../src/pages/checkout/index.astro', import.meta.url), 'utf8'),
  member: await readFile(new URL('../src/lib/checkout-member.ts', import.meta.url), 'utf8'),
  migration: await readFile(new URL('../../supabase/migrations/20260913235000_shop85_member_required_checkout.sql', import.meta.url), 'utf8'),
}

const required = [
  ['policy probe', files.member.includes('get_member_checkout_policy')],
  ['authenticated intent RPC', files.member.includes('prepare_member_checkout_intent')],
  ['checkout fail closed', files.checkout.includes('let memberPolicyLoaded = false') && files.checkout.includes('let memberCheckoutRequired = true')],
  ['submit waits for policy', files.checkout.includes('!memberPolicyLoaded || !memberReady')],
  ['member intent before Store API', files.checkout.indexOf('prepareMemberCheckoutIntent(') < files.checkout.indexOf('fetch(`${api}/checkout`')],
  ['legacy bridge only when policy off', files.checkout.includes('!memberCheckoutRequired && memberState?.authenticated')],
  ['cart cleared only after successful checkout path', files.checkout.indexOf('clearCart();') > files.checkout.indexOf('if (!response.ok) throw')],
  ['intent table', files.migration.includes('commerce_member_checkout_intents')],
  ['server enforcement', files.migration.includes('settings.member_checkout_required is true') && files.migration.includes("raise exception 'MEMBER_CHECKOUT_INTENT_REQUIRED'")],
  ['trusted order ownership', files.migration.includes('customer_profile_snapshot') && files.migration.includes('shipping_address_snapshot')],
  ['verified email gate', files.migration.includes('email_confirmed_at') && files.migration.includes("raise exception 'CUSTOMER_EMAIL_NOT_VERIFIED'")],
  ['shipping address ownership gate', files.migration.includes('customer_id = member_customer.id') && files.migration.includes('is_active = true')],
]

for (const [label, ok] of required) {
  if (!ok) throw new Error(`SHOP-8.5 FAIL: ${label}`)
}

if (/update\s+public\.commerce_store_settings[\s\S]{0,300}member_checkout_required\s*=\s*true/i.test(files.migration)) {
  throw new Error('SHOP-8.5 FAIL: foundation migration must not activate member checkout')
}

const forbiddenFrontend = ['SUPABASE_SECRET_KEY', 'SERVICE_ROLE', 'service_role', 'sb_secret_']
for (const token of forbiddenFrontend) {
  if (files.checkout.includes(token) || files.member.includes(token)) {
    throw new Error(`SHOP-8.5 FAIL: forbidden frontend credential marker ${token}`)
  }
}

console.log('SHOP-8.5 VERIFY PASS — foundation ready, activation intentionally separate')

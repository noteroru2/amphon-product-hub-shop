import { readFile } from 'node:fs/promises'

const files = {
  page: await readFile(new URL('../src/pages/account/orders/index.astro', import.meta.url), 'utf8'),
  client: await readFile(new URL('../src/lib/customer-orders.ts', import.meta.url), 'utf8'),
  layout: await readFile(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8'),
  migration: await readFile(new URL('../../supabase/migrations/20260914001000_shop86_member_order_history.sql', import.meta.url), 'utf8'),
}

const required = [
  ['orders page', files.page.includes('คำสั่งซื้อของฉัน') && files.page.includes('/account/orders/')],
  ['auth redirect', files.page.includes('/account/login/?next=%2Faccount%2Forders%2F')],
  ['order list RPC client', files.client.includes("'get_my_orders'")],
  ['order detail RPC client', files.client.includes("'get_my_order_detail'")],
  ['session bearer auth', files.client.includes('authorization: `Bearer ${session.access_token}`')],
  ['header entrypoint', files.layout.includes('href="/account/orders/"')],
  ['ownership list gate', files.migration.includes('where o.auth_user_id = actor_id')],
  ['ownership detail gate', files.migration.includes('and o.auth_user_id = actor_id')],
  ['read-only order detail', files.migration.includes('commerce_order_items') && files.migration.includes('commerce_shipments') && files.migration.includes('commerce_documents') && files.migration.includes('commerce_warranties')],
  ['anon denied', files.migration.includes('from public, anon')],
  ['authenticated allowed', files.migration.includes('to authenticated')],
  ['no table policy opening', !/create\s+policy[\s\S]+commerce_orders/i.test(files.migration)],
]

for (const [label, ok] of required) {
  if (!ok) throw new Error(`SHOP-8.6 FAIL: ${label}`)
}

const forbiddenFrontend = ['SUPABASE_SECRET_KEY', 'SERVICE_ROLE', 'service_role', 'sb_secret_']
for (const token of forbiddenFrontend) {
  if (files.page.includes(token) || files.client.includes(token)) {
    throw new Error(`SHOP-8.6 FAIL: forbidden frontend credential marker ${token}`)
  }
}

console.log('SHOP-8.6 VERIFY PASS — member order history is auth-owned and read-only')

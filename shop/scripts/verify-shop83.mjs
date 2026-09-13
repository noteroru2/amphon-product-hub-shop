import { readFile } from 'node:fs/promises'

const files = [
  'src/lib/customer-auth.ts',
  'src/lib/customer-account.ts',
  'src/pages/account/index.astro',
  '../supabase/migrations/20260913234500_shop83_customer_address_book_invariants.sql',
]

const contents = await Promise.all(files.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')]))
const source = contents.map(([, text]) => text).join('\n')

const checks = [
  ['customer profile read', source.includes('commerce_customer_profiles') && source.includes('getCustomerProfile')],
  ['profile update', source.includes('updateCustomerProfile')],
  ['address list', source.includes('listCustomerAddresses')],
  ['address create', source.includes('createCustomerAddress')],
  ['address update', source.includes('updateCustomerAddress')],
  ['atomic default RPC', source.includes('set_customer_default_address')],
  ['safe delete RPC', source.includes('delete_customer_address')],
  ['Thai-only address schema', source.includes("country_code: 'TH'") && source.includes('รหัสไปรษณีย์')],
  ['77 provinces UI', source.includes('กรุงเทพมหานคร') && source.includes('อุบลราชธานี')],
  ['member checkout remains out of scope', !source.includes('member_checkout_required = true')],
]
for (const [label, ok] of checks) {
  if (!ok) throw new Error(`SHOP-8.3 FAIL: missing ${label}`)
}

for (const forbidden of ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_', 'service_role']) {
  const frontend = contents.filter(([file]) => file.startsWith('src/')).map(([, text]) => text).join('\n')
  if (frontend.includes(forbidden)) throw new Error(`SHOP-8.3 FAIL: forbidden frontend credential marker ${forbidden}`)
}

console.log('SHOP-8.3 VERIFY PASS')

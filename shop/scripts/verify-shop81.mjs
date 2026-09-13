import { readFile } from 'node:fs/promises'

const requiredFiles = [
  'src/lib/customer-auth.ts',
  'src/pages/account/index.astro',
  'src/pages/account/login.astro',
  'src/pages/account/signup.astro',
  'src/pages/account/verify.astro',
  'src/pages/account/forgot-password.astro',
  'src/pages/account/reset-password.astro',
]

const contents = await Promise.all(requiredFiles.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')]))
const source = contents.map(([, text]) => text).join('\n')

for (const [file, text] of contents) {
  if (!text.trim()) throw new Error(`SHOP-8.1 FAIL: ${file} is empty`)
}

const checks = [
  ['email signup', source.includes('/signup?redirect_to=')],
  ['password login', source.includes('/token?grant_type=password')],
  ['email verification redirect', source.includes('/account/verify/')],
  ['password recovery', source.includes('/recover?redirect_to=')],
  ['password update', source.includes("method: 'PUT'") && source.includes("'/user'")],
  ['session refresh', source.includes('/token?grant_type=refresh_token')],
  ['publishable key only', source.includes('PUBLIC_SUPABASE_PUBLISHABLE_KEY')],
]

for (const [label, ok] of checks) {
  if (!ok) throw new Error(`SHOP-8.1 FAIL: missing ${label}`)
}

const forbidden = ['SUPABASE_SECRET_KEY', 'SERVICE_ROLE', 'service_role', 'sb_secret_']
for (const token of forbidden) {
  if (source.includes(token)) throw new Error(`SHOP-8.1 FAIL: forbidden frontend credential marker ${token}`)
}

console.log('SHOP-8.1 VERIFY PASS')

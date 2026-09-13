import { readFile } from 'node:fs/promises'

const requiredFiles = [
  'src/lib/customer-auth.ts',
  'src/pages/account/index.astro',
  'src/pages/account/login.astro',
  'src/pages/account/signup.astro',
  'src/pages/account/oauth-callback.astro',
  'src/styles/auth.css',
]

const contents = await Promise.all(requiredFiles.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')]))
const source = contents.map(([, text]) => text).join('\n')

for (const [file, text] of contents) {
  if (!text.trim()) throw new Error(`SHOP-8.2 FAIL: ${file} is empty`)
}

const checks = [
  ['Google OAuth authorize route', source.includes('/auth/v1/authorize') && source.includes("provider', 'google")],
  ['OAuth callback route', source.includes('/account/oauth-callback/')],
  ['manual identity linking route', source.includes('/user/identities/authorize?provider=google')],
  ['signed-in linking requires access token', source.includes('headers(session.access_token)')],
  ['linked identity detection', source.includes("customerHasIdentity(user, 'google')")],
  ['login Google entry', source.includes('เข้าสู่ระบบด้วย Google')],
  ['signup Google entry', source.includes('ดำเนินการต่อด้วย Google')],
  ['same-account automatic linking copy', source.includes('บัญชีเดิม')],
  ['publishable client configuration', source.includes('PUBLIC_SUPABASE_PUBLISHABLE_KEY')],
]

for (const [label, ok] of checks) {
  if (!ok) throw new Error(`SHOP-8.2 FAIL: missing ${label}`)
}

const forbidden = [
  'GOOGLE_CLIENT_SECRET',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'sb_secret_',
  'sk_live_',
  'sk_test_',
]
for (const token of forbidden) {
  if (source.includes(token)) throw new Error(`SHOP-8.2 FAIL: forbidden frontend credential marker ${token}`)
}

console.log('SHOP-8.2 VERIFY PASS')

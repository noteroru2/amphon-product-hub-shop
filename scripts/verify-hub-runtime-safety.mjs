import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [main, boundary, recovery, vite, orders, cleanup] = await Promise.all([
  readFile(resolve(root, 'src/main.tsx'), 'utf8'),
  readFile(resolve(root, 'src/components/AppCrashBoundary.tsx'), 'utf8'),
  readFile(resolve(root, 'src/lib/runtimeRecovery.ts'), 'utf8'),
  readFile(resolve(root, 'vite.config.ts'), 'utf8'),
  readFile(resolve(root, 'src/lib/orders.ts'), 'utf8'),
  readFile(resolve(root, 'src/lib/cleanupTasks.ts'), 'utf8'),
])

const checks = [
  ['root render is protected by AppCrashBoundary', main.includes('<AppCrashBoundary>') && main.includes('</AppCrashBoundary>')],
  ['runtime recovery is installed before render', main.includes('installRuntimeRecovery()')],
  ['chunk/import failures are recognized', recovery.includes('failed to fetch dynamically imported module') && recovery.includes('chunkloaderror')],
  ['recovery refreshes service worker before reload', recovery.includes('registration.update()') && recovery.includes('window.location.reload()')],
  ['manual hard recovery preserves product image cache', recovery.includes("name !== 'product-images'")],
  ['error boundary prevents blank screen and exposes recovery action', boundary.includes('AMPHON HUB RECOVERY') && boundary.includes('hardReloadHub')],
  ['Hub build avoids stale lazy chunk filenames', vite.includes('inlineDynamicImports: true')],
  ['PWA removes obsolete precache generations', vite.includes('cleanupOutdatedCaches: true')],
  ['new service worker claims active clients', vite.includes('clientsClaim: true') && vite.includes('skipWaiting: true')],
  ['order API payloads are normalized before render', orders.includes('normalizeOrder') && orders.includes('Array.isArray(result?.orders)')],
  ['order item collections cannot crash .map()', orders.includes('Array.isArray(raw?.items)')],
  ['cleanup task status/priority receive safe string defaults', cleanup.includes('row?.status || "OPEN"') && cleanup.includes('row?.priority || "NORMAL"')],
]

let failed = false
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failed = true
}

if (failed) {
  console.error('HUB runtime safety verification failed')
  process.exit(1)
}

console.log('HUB runtime safety verification PASS — white-screen recovery and stale-PWA defenses are active')

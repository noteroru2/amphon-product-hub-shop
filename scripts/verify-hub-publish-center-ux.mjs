import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [app, main, css] = await Promise.all([
  readFile(resolve(root, 'src/App.tsx'), 'utf8'),
  readFile(resolve(root, 'src/main.tsx'), 'utf8'),
  readFile(resolve(root, 'src/styles/publishCenterOverlay.css'), 'utf8'),
])

const checks = [
  ['Home still opens the governed Publish Center workflow', app.includes('onPublish={() => setTab("publish")}')],
  ['Publish Center component remains the publication workflow owner', app.includes('<PublishCenter')],
  ['overlay stylesheet is loaded after base Hub styles', main.indexOf("./styles/publishCenterOverlay.css") > main.indexOf("./styles/app.css")],
  ['Publish Center is rendered as an in-context fixed work sheet', css.includes('.publish-center-screen') && css.includes('position: fixed')],
  ['background Hub navigation is disabled while the work sheet is open', css.includes('body:has(.publish-center-screen) .bottom-nav') && css.includes('pointer-events: none')],
  ['work sheet has a dimmed backdrop instead of looking like a second page', css.includes('100vmax rgba(15, 23, 42, 0.38)')],
  ['mobile-safe viewport and scrolling are preserved', css.includes('env(safe-area-inset-top)') && css.includes('overflow-y: auto')],
  ['Publish Center identity is visible in the work sheet header', css.includes('content: "PUBLISH CENTER"') && css.includes('content: "ลงขายสินค้า"')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`HUB Publish Center UX verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('HUB Publish Center UX verification PASS — publication workflow stays in the Hub as a focused work sheet')

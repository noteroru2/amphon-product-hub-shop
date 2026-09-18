import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [app, publishCenter, main, css] = await Promise.all([
  readFile(resolve(root, 'src/App.tsx'), 'utf8'),
  readFile(resolve(root, 'src/components/PublishCenter.tsx'), 'utf8'),
  readFile(resolve(root, 'src/main.tsx'), 'utf8'),
  readFile(resolve(root, 'src/styles/publishCenterOverlay.css'), 'utf8'),
])

const checks = [
  ['Home still opens the governed Shop/Website manager', app.includes('onPublish={() => setTab("publish")}') && app.includes('Shop / เว็บไซต์')],
  ['Publish Center remains the Shop/Website workflow owner', app.includes('<PublishCenter')],
  ['Social status tracker is not wired into active Hub UI', !app.includes('SalesChannelTracker')],
  ['Home no longer asks staff to complete Facebook/Marketplace/LINE publication status', !app.includes('เช็กว่า Facebook / Marketplace') && !app.includes('ลงครบหรือยัง')],
  ['Publish Center renders only the Website publication channel', publishCenter.includes('visiblePublicationChannels') && publishCenter.includes('channel.id === "website"')],
  ['Social publication state actions are absent from Website manager', !publishCenter.includes('ทำเครื่องหมายว่าโพสต์ Facebook') && !publishCenter.includes('ทำเครื่องหมายว่าส่ง LINE') && !publishCenter.includes('ทำเครื่องหมายว่าโพสต์ Marketplace')],
  ['overlay stylesheet is loaded after base Hub styles', main.indexOf("./styles/publishCenterOverlay.css") > main.indexOf("./styles/app.css")],
  ['Website manager is rendered as an in-context fixed work sheet', css.includes('.publish-center-screen') && css.includes('position: fixed')],
  ['background Hub navigation is disabled while the work sheet is open', css.includes('body:has(.publish-center-screen) .bottom-nav') && css.includes('pointer-events: none')],
  ['work sheet has a dimmed backdrop instead of looking like a second page', css.includes('100vmax rgba(15, 23, 42, 0.38)')],
  ['mobile-safe viewport and scrolling are preserved', css.includes('env(safe-area-inset-top)') && css.includes('overflow-y: auto')],
  ['Website-manager identity is visible in the work sheet header', css.includes('content: "AMPHON SHOP"') && css.includes('content: "สินค้าในเว็บไซต์"')],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`HUB Website Manager UX verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('HUB Website Manager UX verification PASS — social publication status is retired and AMPHON SHOP remains a focused work sheet')

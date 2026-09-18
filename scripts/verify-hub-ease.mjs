import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [main, css, app] = await Promise.all([
  readFile(resolve(root, 'src/main.tsx'), 'utf8'),
  readFile(resolve(root, 'src/styles/hubEase.css'), 'utf8'),
  readFile(resolve(root, 'src/App.tsx'), 'utf8'),
])

const checks = [
  ['Hub Ease stylesheet is loaded after base and Publish Center styles',
    main.indexOf("./styles/hubEase.css") > main.indexOf("./styles/publishCenterOverlay.css")],
  ['Bottom navigation keeps all five destinations readable',
    css.includes('grid-template-columns: repeat(5, minmax(0, 1fr))')],
  ['Primary Add action remains visually dominant',
    css.includes('.primary-add') && css.includes('min-height: 60px')],
  ['Inventory search remains visible while scanning a long list',
    css.includes('.searchbox') && css.includes('position: sticky')],
  ['Product titles can use two lines instead of destructive truncation',
    css.includes('.product-top h3') && css.includes('-webkit-line-clamp: 2')],
  ['Readiness/completeness remains visually prominent in edit flow',
    css.includes('.completeness-card') && css.includes('.completeness-bar')],
  ['Keyboard focus is visible', css.includes(':focus-visible')],
  ['Reduced motion preference is respected', css.includes('prefers-reduced-motion: reduce')],
  ['Home dashboard shows the waiting-for-photos backlog separately',
    app.includes('label="รอรูปภาพ"') && app.includes('product.status === "draft"')],
  ['Home dashboard separates photo-ready items waiting for listing data',
    app.includes('label="รอข้อมูลลงขาย"') && app.includes('product.status === "photo_ready"')],
  ['UX layer does not hide primary Hub actions',
    !/\.(?:primary-add|publish-center-launch|product-card|bottom-nav)[^{]*\{[^}]*display\s*:\s*none/i.test(css)],
]

const failed = checks.filter(([, ok]) => !ok)
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)

if (failed.length) {
  console.error(`HUB Ease verification failed: ${failed.map(([label]) => label).join(', ')}`)
  process.exit(1)
}

console.log('HUB UX/UI simplification verification PASS')

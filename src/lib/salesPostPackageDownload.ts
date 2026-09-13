import type { ProductDraft } from '../types/product'
import { MAX_ZIP_EXPORT_BYTES, prepareProductImageFiles } from './productImageExport'
import type { SalesPostPackage } from './salesPostPackage'

function safeFolder(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'sales-package'
}

export async function downloadSalesPostPackage(pkg: SalesPostPackage, draft: ProductDraft, preparedFiles: File[] = []) {
  const [{ strToU8, zipSync }, files] = await Promise.all([
    import('fflate'),
    preparedFiles.length === pkg.imageCount
      ? Promise.resolve(preparedFiles)
      : prepareProductImageFiles(draft, { maxTotalBytes: MAX_ZIP_EXPORT_BYTES }),
  ])
  const folder = safeFolder(pkg.sku)
  const entries: Record<string, Uint8Array> = {}
  for (const file of files) entries[`${folder}/${file.name}`] = new Uint8Array(await file.arrayBuffer())
  entries[`${folder}/ข้อความขาย.txt`] = strToU8(pkg.captions.GENERAL)
  entries[`${folder}/marketplace.txt`] = strToU8(pkg.captions.MARKETPLACE)
  entries[`${folder}/facebook-page.txt`] = strToU8(pkg.captions.FACEBOOK_PAGE)
  entries[`${folder}/line.txt`] = strToU8(pkg.captions.LINE)

  const zipped = zipSync(entries, { level: 6 })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${folder}-sales-post-package.zip`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

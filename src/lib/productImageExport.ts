import type { ProductDraft, ProductImageDraft } from '../types/product'

export const MAX_EXPORT_IMAGES = 20
export const MAX_NATIVE_SHARE_BYTES = 200 * 1024 * 1024
export const MAX_ZIP_EXPORT_BYTES = 500 * 1024 * 1024
const MAX_SINGLE_IMAGE_BYTES = 50 * 1024 * 1024

export class ProductImageExportError extends Error {
  constructor(public readonly code: 'NO_IMAGES' | 'FETCH_FAILED' | 'INVALID_IMAGE' | 'TOO_LARGE' | 'UNSUPPORTED', message: string) {
    super(message)
    this.name = 'ProductImageExportError'
  }
}

export interface ProductImagePreparationProgress {
  completed: number
  total: number
}

export interface PrepareProductImageOptions {
  signal?: AbortSignal
  maxTotalBytes?: number
  onProgress?: (progress: ProductImagePreparationProgress) => void
}

function safeBaseName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'product'
}

function fileExtension(contentType: string, url: string) {
  const mime = contentType.toLowerCase().split(';')[0].trim()
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'image/heif') return 'heif'
  if (mime === 'image/gif') return 'gif'
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/)
  return match?.[1]?.toLowerCase() || 'jpg'
}

export function orderedRemoteProductImages(images: ProductImageDraft[]) {
  return images
    .filter((image): image is ProductImageDraft & { publicUrl: string } => Boolean(image.publicUrl))
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_EXPORT_IMAGES)
}

async function fetchImage(url: string, signal?: AbortSignal) {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal, credentials: 'omit', headers: { accept: 'image/*' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (!contentType.startsWith('image/')) throw new ProductImageExportError('INVALID_IMAGE', 'ไฟล์ที่ได้รับไม่ใช่รูปภาพ')
      const blob = await response.blob()
      if (!blob.size) throw new ProductImageExportError('INVALID_IMAGE', 'ไฟล์รูปภาพว่างเปล่า')
      if (blob.size > MAX_SINGLE_IMAGE_BYTES) throw new ProductImageExportError('TOO_LARGE', 'มีรูปที่มีขนาดใหญ่เกินไปสำหรับการส่งออกบนมือถือ')
      return blob.type ? blob : blob.slice(0, blob.size, contentType)
    } catch (error) {
      if (signal?.aborted) throw error
      if (error instanceof ProductImageExportError) throw error
      lastError = error
    }
  }
  throw new ProductImageExportError('FETCH_FAILED', `โหลดรูปไม่สำเร็จ${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
}

export async function prepareProductImageFiles(draft: ProductDraft, options: PrepareProductImageOptions = {}) {
  const images = orderedRemoteProductImages(draft.images)
  if (!images.length) throw new ProductImageExportError('NO_IMAGES', 'สินค้านี้ยังไม่มีรูปที่อัปโหลดขึ้นระบบ')

  const sku = safeBaseName(draft.sku || 'product')
  const maxTotalBytes = options.maxTotalBytes ?? MAX_NATIVE_SHARE_BYTES
  const files: File[] = []
  let totalBytes = 0
  options.onProgress?.({ completed: 0, total: images.length })

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    let blob: Blob
    try {
      blob = await fetchImage(image.publicUrl, options.signal)
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (error instanceof ProductImageExportError) throw new ProductImageExportError(error.code, `รูปที่ ${index + 1}: ${error.message}`)
      throw error
    }
    totalBytes += blob.size
    if (totalBytes > maxTotalBytes) throw new ProductImageExportError('TOO_LARGE', 'รูปทั้งหมดมีขนาดใหญ่เกินไปสำหรับการแชร์พร้อมกัน กรุณาใช้ ZIP')
    const extension = fileExtension(blob.type, image.publicUrl)
    files.push(new File([blob], `${sku}-${String(index + 1).padStart(2, '0')}.${extension}`, {
      type: blob.type,
      lastModified: Date.now(),
    }))
    options.onProgress?.({ completed: index + 1, total: images.length })
  }

  return files
}

export function canNativeShareProductImages(files: File[]) {
  return Boolean(files.length && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files }))
}

export function sharePreparedProductImageFiles(files: File[]) {
  if (!canNativeShareProductImages(files)) {
    throw new ProductImageExportError('UNSUPPORTED', 'อุปกรณ์นี้ไม่รองรับการบันทึกรูปหลายไฟล์พร้อมกัน กรุณาใช้ ZIP')
  }
  // Keep this call immediate and files-only so the click retains mobile user activation
  // and iOS presents the operation as an image-file share rather than a link share.
  return navigator.share({ files })
}

export function isShareCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function downloadSingleProductImage(draft: ProductDraft, index: number) {
  const images = orderedRemoteProductImages(draft.images)
  const image = images[index]
  if (!image) throw new ProductImageExportError('NO_IMAGES', 'ไม่พบรูปที่ต้องการดาวน์โหลด')
  const blob = await fetchImage(image.publicUrl)
  const extension = fileExtension(blob.type, image.publicUrl)
  const filename = `${safeBaseName(draft.sku || 'product')}-${String(index + 1).padStart(2, '0')}.${extension}`
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

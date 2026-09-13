import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import type { ProductSummary } from '../types/product'

export interface ProductCodeImages {
  deepLink: string
  qrDataUrl: string
  barcodeDataUrl: string
}

export function buildProductDeepLink(sku: string) {
  const configuredBase = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim()
  const base = configuredBase || (window.location.origin + window.location.pathname)
  const url = new URL(base)
  url.searchParams.set('sku', sku)
  return url.toString()
}

export function extractProductLookup(raw: string) {
  const clean = raw.trim()
  if (!clean) return ''

  try {
    const url = new URL(clean)
    const sku = url.searchParams.get('sku')
    if (sku) return sku.trim()
  } catch {
    // Raw SKU / serial / barcode is expected too.
  }

  const prefixed = clean.match(/^ATSKU:(.+)$/i)
  if (prefixed?.[1]) return prefixed[1].trim()

  const skuMatch = clean.match(/AT-[A-Z0-9]{1,8}-\d{4}-\d{4,10}/i)
  if (skuMatch?.[0]) return skuMatch[0]

  return clean
}

function normalizeLookup(value?: string) {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function findProductByScannedValue(products: ProductSummary[], raw: string) {
  const lookup = normalizeLookup(extractProductLookup(raw))
  if (!lookup) return undefined
  return products.find((product) => {
    return normalizeLookup(product.sku) === lookup || normalizeLookup(product.serialNumber) === lookup
  })
}

export async function generateProductCodeImages(sku: string): Promise<ProductCodeImages> {
  const deepLink = buildProductDeepLink(sku)
  const qrDataUrl = await QRCode.toDataURL(deepLink, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 440,
  })

  const canvas = document.createElement('canvas')
  JsBarcode(canvas, sku, {
    format: 'CODE128',
    displayValue: false,
    height: 72,
    width: 2,
    margin: 8,
    background: '#ffffff',
    lineColor: '#000000',
  })

  return {
    deepLink,
    qrDataUrl,
    barcodeDataUrl: canvas.toDataURL('image/png'),
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

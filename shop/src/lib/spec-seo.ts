import type { SpecDimension, SpecPage, StoreProduct } from './store-api'

function text(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function matchFirst(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1]?.toLowerCase() || null
}

export function normalizeProductSpecToken(dimension: SpecDimension | string, raw: unknown): string | null {
  const value = text(raw)
  const kind = String(dimension || '').toUpperCase()
  if (!value) return null

  if (kind === 'GPU') {
    const rtx50 = matchFirst(value, /rtx\s*(50\d{2})/i)
    if (rtx50) return `rtx-${rtx50}`
    const rtx40 = matchFirst(value, /rtx\s*(40\d{2})/i)
    if (rtx40) return `rtx-${rtx40}`
    const rtx30 = matchFirst(value, /rtx\s*(30\d{2})/i)
    if (rtx30) return `rtx-${rtx30}`
    const rtx20 = matchFirst(value, /rtx\s*(20\d{2})/i)
    if (rtx20) return `rtx-${rtx20}`
    const gtx16 = matchFirst(value, /gtx\s*(16\d{2})/i)
    if (gtx16) return `gtx-${gtx16}`
    const gtx10 = matchFirst(value, /gtx\s*(10\d{2})/i)
    if (gtx10) return `gtx-${gtx10}`
    return null
  }

  if (kind === 'CPU') {
    const intel = matchFirst(value, /(i[3579]-\d{4,5}[a-z]{0,2})/i)
    if (intel) return `intel-${intel}`
    const amd = matchFirst(value, /(ryzen\s+[3579]\s+\d{4}[a-z]{0,2})/i)
    if (amd) return `amd-${amd.replace(/\s+/g, '-')}`
    return null
  }

  if (kind === 'RAM') {
    if (/32\s*gb/i.test(value)) return '32gb'
    if (/16\s*gb/i.test(value)) return '16gb'
    if (/8\s*gb/i.test(value) || /^8$/.test(value)) return '8gb'
    if (/4\s*gb/i.test(value)) return '4gb'
    return null
  }

  if (kind === 'STORAGE') {
    if (/2\s*tb/i.test(value)) return '2tb'
    if (/1\s*tb/i.test(value) || /1024\s*gb/i.test(value)) return '1tb'
    if (/512\s*gb/i.test(value)) return '512gb'
    if (/256\s*gb/i.test(value)) return '256gb'
    return null
  }

  return null
}

export function productSpecToken(product: StoreProduct, dimension: SpecDimension | string) {
  const kind = String(dimension || '').toUpperCase()
  if (kind === 'GPU') return normalizeProductSpecToken(kind, product.specs?.gpu)
  if (kind === 'CPU') return normalizeProductSpecToken(kind, product.specs?.cpu)
  if (kind === 'RAM') return normalizeProductSpecToken(kind, product.specs?.ram)
  if (kind === 'STORAGE') return normalizeProductSpecToken(kind, product.specs?.ssd ?? product.specs?.storage)
  return null
}

export function matchesSpecPage(product: StoreProduct, page: Pick<SpecPage, 'dimension' | 'token'>) {
  return productSpecToken(product, page.dimension) === page.token
}

export function specDimensionLabel(dimension: SpecDimension | string) {
  switch (String(dimension).toUpperCase()) {
    case 'GPU': return 'การ์ดจอ / GPU'
    case 'CPU': return 'CPU'
    case 'RAM': return 'RAM'
    case 'STORAGE': return 'SSD / Storage'
    default: return String(dimension)
  }
}

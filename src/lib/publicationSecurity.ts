export function validatePublicationExternalUrl(value?: string) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported')
    return parsed.toString()
  } catch {
    throw new Error('URL ประกาศต้องขึ้นต้นด้วย http:// หรือ https://')
  }
}

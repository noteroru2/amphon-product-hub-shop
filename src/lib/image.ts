async function imageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch {
      // Safari/format fallback below.
    }
  }

  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('ไม่สามารถอ่านรูปนี้ได้'))
  })
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    cleanup: () => URL.revokeObjectURL(url),
  }
}

export async function compressImage(file: File, maxDimension = 2000, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const decoded = await imageSource(file)
  try {
    const ratio = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * ratio))
    const height = Math.max(1, Math.round(decoded.height * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.drawImage(decoded.source, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((out) => out ? resolve(out) : reject(new Error('Image compression failed')), 'image/jpeg', quality)
    })
  } finally {
    decoded.cleanup()
  }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProductDraft } from '../types/product'
import {
  canNativeShareProductImages,
  isShareCancellation,
  orderedRemoteProductImages,
  prepareProductImageFiles,
  ProductImageExportError,
  sharePreparedProductImageFiles,
  type ProductImagePreparationProgress,
} from '../lib/productImageExport'

export type ProductImageExportStatus = 'empty' | 'preparing' | 'ready' | 'fallback' | 'error'
export type ProductImageExportController = ReturnType<typeof useProductImageExport>

export function useProductImageExport(draft: ProductDraft) {
  const remoteImages = useMemo(() => orderedRemoteProductImages(draft.images), [draft.images])
  const signature = useMemo(
    () => `${draft.sku || draft.localId}:${remoteImages.map((image) => `${image.id}:${image.order}:${image.publicUrl}`).join('|')}`,
    [draft.localId, draft.sku, remoteImages],
  )
  const [status, setStatus] = useState<ProductImageExportStatus>('empty')
  const [progress, setProgress] = useState<ProductImagePreparationProgress>({ completed: 0, total: remoteImages.length })
  const [files, setFiles] = useState<File[]>([])
  const [preparedSignature, setPreparedSignature] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setFiles([])
    setPreparedSignature('')
    setMessage(null)
    setProgress({ completed: 0, total: remoteImages.length })

    if (!remoteImages.length) {
      setStatus('empty')
      return () => controller.abort()
    }
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      setStatus('fallback')
      setMessage('อุปกรณ์นี้ใช้ดาวน์โหลด ZIP แทนการบันทึกหลายรูปพร้อมกัน')
      return () => controller.abort()
    }

    setStatus('preparing')
    void prepareProductImageFiles(draft, {
      signal: controller.signal,
      onProgress: (next) => { if (active) setProgress(next) },
    }).then((prepared) => {
      if (!active) return
      if (!canNativeShareProductImages(prepared)) {
        setStatus('fallback')
        setMessage('อุปกรณ์นี้ใช้ดาวน์โหลด ZIP แทนการบันทึกหลายรูปพร้อมกัน')
        return
      }
      setFiles(prepared)
      setPreparedSignature(signature)
      setStatus('ready')
      setMessage(`พร้อมบันทึก ${prepared.length} รูป`)
    }).catch((error) => {
      if (!active || controller.signal.aborted) return
      if (error instanceof ProductImageExportError && error.code === 'TOO_LARGE') {
        setStatus('fallback')
        setMessage(error.message)
        return
      }
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'เตรียมรูปไม่สำเร็จ กรุณาลองใหม่')
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, draft, remoteImages.length, signature])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const share = useCallback(() => {
    if (preparedSignature !== signature) throw new ProductImageExportError('INVALID_IMAGE', 'สินค้ามีการเปลี่ยนแปลง กรุณารอเตรียมรูปชุดใหม่')
    return sharePreparedProductImageFiles(files)
  }, [files, preparedSignature, signature])

  return {
    count: remoteImages.length,
    files,
    isCancellation: isShareCancellation,
    message,
    progress,
    retry,
    share,
    status,
  }
}

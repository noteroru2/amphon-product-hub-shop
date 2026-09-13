import { useState } from 'react'
import { Download, ImageDown, LoaderCircle, RefreshCw, Share2 } from 'lucide-react'
import type { ProductDraft } from '../types/product'
import { useProductImageExport, type ProductImageExportController } from '../hooks/useProductImageExport'
import { downloadProductZip } from '../lib/sales'
import { downloadSingleProductImage, orderedRemoteProductImages } from '../lib/productImageExport'

export function ProductImageExportControls({ draft, imageExport, compact = false }: { draft: ProductDraft; imageExport: ProductImageExportController; compact?: boolean }) {
  const [busy, setBusy] = useState<'share' | 'zip' | 'single' | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const images = orderedRemoteProductImages(draft.images)
  const disabled = busy !== null || imageExport.status === 'preparing' || imageExport.status === 'empty'

  async function primaryAction() {
    if (imageExport.status === 'error') {
      setActionMessage(null)
      imageExport.retry()
      return
    }
    if (imageExport.status === 'fallback') {
      await downloadZip()
      return
    }
    if (imageExport.status !== 'ready') return
    setBusy('share')
    setActionMessage(null)
    try {
      // Files are already prepared; navigator.share is invoked immediately from this click.
      await imageExport.share()
      setActionMessage(`เปิดเมนูบันทึก ${imageExport.count} รูปแล้ว`)
    } catch (error) {
      if (!imageExport.isCancellation(error)) setActionMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function downloadZip() {
    setBusy('zip')
    setActionMessage(null)
    try {
      await downloadProductZip(draft)
      setActionMessage('สร้าง ZIP รูปต้นฉบับพร้อมคอนเทนต์แล้ว')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function downloadOne(index: number) {
    setBusy('single')
    setActionMessage(null)
    try {
      await downloadSingleProductImage(draft, index)
      setActionMessage(`ดาวน์โหลดรูปที่ ${index + 1} แล้ว`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const primaryLabel = busy === 'share'
    ? 'กำลังเปิดเมนูบันทึก...'
    : busy === 'zip'
      ? 'กำลังสร้าง ZIP...'
      : imageExport.status === 'preparing'
        ? `กำลังเตรียมรูป ${imageExport.progress.completed}/${imageExport.progress.total}...`
        : imageExport.status === 'ready'
          ? `บันทึกรูปทั้งหมด (${imageExport.count})`
          : imageExport.status === 'fallback'
            ? 'ดาวน์โหลดรูปทั้งหมดเป็น ZIP'
            : imageExport.status === 'error'
              ? 'ลองเตรียมรูปอีกครั้ง'
              : 'ยังไม่มีรูปที่พร้อมบันทึก'

  return <section className={`product-image-export ${compact ? 'compact' : ''}`} data-hub2-image-export>
    <button
      type="button"
      className="bulk-image-primary"
      onClick={() => void primaryAction()}
      disabled={disabled}
      data-hub2-primary
    >
      {busy === 'share' || imageExport.status === 'preparing' ? <LoaderCircle className="spin" size={19}/> : imageExport.status === 'ready' ? <Share2 size={19}/> : imageExport.status === 'error' ? <RefreshCw size={19}/> : <Download size={19}/>}
      <span>{primaryLabel}</span>
    </button>
    {imageExport.status !== 'fallback' && imageExport.status !== 'empty' && <button type="button" className="image-export-fallback" onClick={() => void downloadZip()} disabled={busy !== null || imageExport.status === 'preparing'}><Download size={17}/>ดาวน์โหลด ZIP</button>}
    <div className="image-export-status" aria-live="polite">{actionMessage || imageExport.message}</div>
    {!!images.length && <details className="individual-image-downloads">
      <summary><ImageDown size={16}/>ดาวน์โหลดทีละรูป</summary>
      <div>{images.map((image, index) => <button type="button" key={image.id} onClick={() => void downloadOne(index)} disabled={busy !== null}>รูปที่ {index + 1}</button>)}</div>
    </details>}
  </section>
}

export function ProductImageExportActions({ draft, compact = false }: { draft: ProductDraft; compact?: boolean }) {
  const imageExport = useProductImageExport(draft)
  return <ProductImageExportControls draft={draft} imageExport={imageExport} compact={compact}/>
}

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { hardReloadHub, isRecoverableChunkError } from '../lib/runtimeRecovery'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class AppCrashBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AMPHON Hub] render crash', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    const chunkFailure = isRecoverableChunkError(this.state.error)
    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 20,
          background: '#f8fafc',
          color: '#172033',
          fontFamily: 'Inter, Noto Sans Thai, system-ui, sans-serif',
        }}
      >
        <section
          style={{
            width: 'min(100%, 440px)',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 22,
            padding: 20,
            boxShadow: '0 16px 40px rgba(15,23,42,.08)',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: '#ea580c', letterSpacing: '.08em' }}>
            AMPHON HUB RECOVERY
          </div>
          <h1 style={{ margin: '7px 0 8px', fontSize: 24 }}>
            {chunkFailure ? 'แอปมีเวอร์ชันใหม่' : 'หน้านี้เปิดไม่สำเร็จ'}
          </h1>
          <p style={{ margin: '0 0 16px', color: '#64748b', lineHeight: 1.65, fontSize: 13 }}>
            {chunkFailure
              ? 'ไฟล์ของ PWA คนละเวอร์ชันกัน ระบบจะโหลดไฟล์ล่าสุดใหม่โดยไม่ลบข้อมูลสินค้า'
              : 'เกิดข้อผิดพลาดในหน้าจอนี้ แทนที่จะปล่อยเป็นจอขาว คุณสามารถโหลด Hub ใหม่ได้ทันที'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              width: '100%',
              minHeight: 52,
              border: 0,
              borderRadius: 14,
              background: '#f97316',
              color: '#fff',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            โหลดใหม่
          </button>
          <button
            type="button"
            onClick={() => void hardReloadHub()}
            style={{
              width: '100%',
              minHeight: 48,
              marginTop: 8,
              border: '1px solid #dbe1ea',
              borderRadius: 14,
              background: '#fff',
              color: '#334155',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ล้างไฟล์แอปเก่าและเปิดใหม่
          </button>
          <small style={{ display: 'block', marginTop: 12, color: '#94a3b8', lineHeight: 1.5 }}>
            ข้อมูลสินค้าใน Supabase และร่างในเครื่องจะไม่ถูกลบ
          </small>
        </section>
      </main>
    )
  }
}

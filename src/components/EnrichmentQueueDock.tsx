import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type ListingReadiness =
  | 'INTAKE_ONLY'
  | 'PHOTO_PENDING'
  | 'SPEC_PENDING'
  | 'LISTING_CONTENT_PENDING'
  | 'READY_TO_LIST'
  | null

type BatteryHealthGrade = 'LOW' | 'GOOD' | 'VERY_GOOD' | 'UNKNOWN' | null

type EnrichmentProduct = {
  id: string
  sku: string
  title: string
  category: string
  subtype: string | null
  status: string
  battery_health_grade: BatteryHealthGrade
  one_listing_readiness: ListingReadiness
  one_photos_complete: boolean
  one_specs_complete: boolean
  one_listing_content_complete: boolean
  updated_at: string
}

const enabled = import.meta.env.VITE_ONE2C_ENRICHMENT_ENABLED === 'true'

const readinessLabel: Record<Exclude<ListingReadiness, null>, string> = {
  INTAKE_ONLY: 'รับเข้าแล้ว · ยังไม่เริ่ม',
  PHOTO_PENDING: 'รอรูป',
  SPEC_PENDING: 'รอสเปก',
  LISTING_CONTENT_PENDING: 'รอข้อมูลลงขาย',
  READY_TO_LIST: 'พร้อมลงขาย',
}

const readinessOrder: Record<Exclude<ListingReadiness, null>, number> = {
  INTAKE_ONLY: 0,
  PHOTO_PENDING: 1,
  SPEC_PENDING: 2,
  LISTING_CONTENT_PENDING: 3,
  READY_TO_LIST: 4,
}

const batteryLabel: Record<Exclude<BatteryHealthGrade, null>, string> = {
  LOW: 'ต่ำ',
  GOOD: 'ดี',
  VERY_GOOD: 'ดีมาก',
  UNKNOWN: 'ไม่ทราบ',
}

function batteryApplicable(product: EnrichmentProduct) {
  if (['notebook', 'iphone', 'smartphone', 'tablet'].includes(product.category)) return true
  return product.category === 'gaming' && ['switch', 'steam_deck', 'handheld'].includes(product.subtype || '')
}

function openProduct(sku: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('sku', sku)
  window.location.assign(url.toString())
}

export function EnrichmentQueueDock() {
  const [open, setOpen] = useState(false)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [products, setProducts] = useState<EnrichmentProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batterySavingId, setBatterySavingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!enabled || !supabase || !sessionUserId) return
    setLoading(true)
    const { data, error: queryError } = await supabase
      .from('products')
      .select('id,sku,title,category,subtype,status,battery_health_grade,one_listing_readiness,one_photos_complete,one_specs_complete,one_listing_content_complete,updated_at')
      .eq('one_managed', true)
      .in('status', ['draft', 'photo_ready', 'ready_to_list'])
      .order('updated_at', { ascending: false })
      .limit(250)

    if (queryError) {
      setError(queryError.message)
      setLoading(false)
      return
    }

    setProducts((data ?? []) as EnrichmentProduct[])
    setError(null)
    setLoading(false)
  }, [sessionUserId])

  useEffect(() => {
    if (!enabled || !supabase) return
    let active = true

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSessionUserId(data.session?.user.id ?? null)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSessionUserId(session?.user.id ?? null)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!enabled || !client || !sessionUserId) return
    void refresh()

    const channel = client
      .channel('one2c-enrichment-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => void refresh(),
      )
      .subscribe()

    const timer = window.setInterval(() => void refresh(), 30_000)

    return () => {
      window.clearInterval(timer)
      void client.removeChannel(channel)
    }
  }, [refresh, sessionUserId])

  const counts = useMemo(() => {
    const result = {
      intake: 0,
      photos: 0,
      specs: 0,
      content: 0,
      ready: 0,
      pending: 0,
    }
    for (const product of products) {
      const state = product.one_listing_readiness
      if (state === 'INTAKE_ONLY') result.intake += 1
      if (!product.one_photos_complete) result.photos += 1
      if (!product.one_specs_complete) result.specs += 1
      if (!product.one_listing_content_complete) result.content += 1
      if (state === 'READY_TO_LIST') result.ready += 1
      else result.pending += 1
    }
    return result
  }, [products])

  const pendingProducts = useMemo(
    () => products
      .filter((product) => product.one_listing_readiness !== 'READY_TO_LIST')
      .sort((a, b) => {
        const aOrder = a.one_listing_readiness ? readinessOrder[a.one_listing_readiness] : 99
        const bOrder = b.one_listing_readiness ? readinessOrder[b.one_listing_readiness] : 99
        if (aOrder !== bOrder) return aOrder - bOrder
        return Date.parse(a.updated_at) - Date.parse(b.updated_at)
      })
      .slice(0, 30),
    [products],
  )

  async function changeBattery(product: EnrichmentProduct, value: string) {
    if (!supabase || !sessionUserId) return
    const grade = value as Exclude<BatteryHealthGrade, null>
    setBatterySavingId(product.id)
    const { error: updateError } = await supabase
      .from('products')
      .update({ battery_health_grade: grade, updated_by: sessionUserId })
      .eq('id', product.id)
      .eq('one_managed', true)

    if (updateError) setError(updateError.message)
    else await refresh()
    setBatterySavingId(null)
  }

  if (!enabled || !supabase || !sessionUserId) return null

  return (
    <aside className={`one2c-dock ${open ? 'is-open' : ''}`} aria-label="คิวเตรียมสินค้า AMPHON ONE">
      {!open ? (
        <button className="one2c-dock-trigger" type="button" onClick={() => setOpen(true)}>
          <span>งานเตรียมสินค้า</span>
          <strong>{counts.pending}</strong>
        </button>
      ) : (
        <div className="one2c-panel">
          <div className="one2c-panel-head">
            <div>
              <strong>งานเตรียมสินค้า</strong>
              <small>รูป · สเปก · ข้อมูลลงขาย ทำคนละเวลาได้</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="ปิดคิว">×</button>
          </div>

          <div className="one2c-count-grid">
            <div><strong>{counts.intake}</strong><span>ยังไม่เริ่ม</span></div>
            <div><strong>{counts.photos}</strong><span>รอรูป</span></div>
            <div><strong>{counts.specs}</strong><span>รอสเปก</span></div>
            <div><strong>{counts.content}</strong><span>รอข้อมูลขาย</span></div>
            <div className="ready"><strong>{counts.ready}</strong><span>พร้อมลงขาย</span></div>
          </div>

          <div className="one2c-toolbar">
            <span>{loading ? 'กำลังอัปเดต…' : `ค้าง ${counts.pending} ชิ้น`}</span>
            <button type="button" onClick={() => void refresh()} disabled={loading}>รีเฟรช</button>
          </div>

          {error && <div className="one2c-error">{error}</div>}

          <div className="one2c-list">
            {pendingProducts.map((product) => {
              const state = product.one_listing_readiness || 'INTAKE_ONLY'
              return (
                <article className="one2c-item" key={product.id}>
                  <button className="one2c-item-main" type="button" onClick={() => openProduct(product.sku)}>
                    <span className={`one2c-state state-${state.toLowerCase()}`}>{readinessLabel[state]}</span>
                    <strong>{product.sku}</strong>
                    <span className="one2c-title">{product.title}</span>
                    <span className="one2c-checks">
                      <span className={product.one_photos_complete ? 'done' : ''}>รูป {product.one_photos_complete ? '✓' : '–'}</span>
                      <span className={product.one_specs_complete ? 'done' : ''}>สเปก {product.one_specs_complete ? '✓' : '–'}</span>
                      <span className={product.one_listing_content_complete ? 'done' : ''}>ข้อมูลขาย {product.one_listing_content_complete ? '✓' : '–'}</span>
                    </span>
                  </button>

                  {batteryApplicable(product) && (
                    <label className="one2c-battery">
                      <span>แบต</span>
                      <select
                        value={product.battery_health_grade || 'UNKNOWN'}
                        disabled={batterySavingId === product.id}
                        onChange={(event) => void changeBattery(product, event.target.value)}
                      >
                        {(['UNKNOWN', 'LOW', 'GOOD', 'VERY_GOOD'] as const).map((grade) => (
                          <option key={grade} value={grade}>{batteryLabel[grade]}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </article>
              )
            })}

            {!loading && pendingProducts.length === 0 && (
              <div className="one2c-empty">ไม่มีสินค้าค้างเตรียม 🎉</div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

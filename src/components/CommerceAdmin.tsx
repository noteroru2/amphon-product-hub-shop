import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Tags,
  X,
} from 'lucide-react'
import {
  canonicalShopUrl,
  createCommerceModel,
  createCommerceSeries,
  getCommerceCatalog,
  getCommerceStoreSettings,
  listCommerceTaxonomyCandidates,
  merchantBlockerLabel,
  prepareCommerceProduct,
  refreshCommerceMappings,
  updateCommerceProduct,
  updateCommerceStoreSettings,
  validateGtin,
} from '../lib/commerce'
import {
  discoverShopee,
  getShopeeStatus,
  saveShopeeCategoryMapping,
  seedShopeeQueue,
  startShopeeAuthorization,
  type ShopeeStatus,
} from '../lib/shopee'
import type {
  CommerceCatalog,
  CommerceIndexPolicy,
  CommerceProductConfig,
  CommerceStoreSettings,
  CommerceTaxonomyCandidate,
  MerchantItemCondition,
  ProductCategory,
  ProductSummary,
  Profile,
} from '../types/product'

const EMPTY_CATALOG: CommerceCatalog = { categories: [], brands: [], series: [], models: [] }

function nullable(value: string) {
  const next = value.trim()
  return next ? next : null
}

function numberValue(value: string) {
  if (!value.trim()) return undefined
  const next = Number(value)
  return Number.isFinite(next) ? next : undefined
}

function canonicalPathLabel(config: CommerceProductConfig | null) {
  if (!config?.canonicalPath) return 'ระบบจะสร้าง Canonical URL หลัง Prepare'
  return config.canonicalPath
}

export function ProductCommerceEditor({
  profile,
  product,
  onClose,
  onSaved,
}: {
  profile: Profile
  product: ProductSummary
  onClose: () => void
  onSaved?: (config: CommerceProductConfig) => Promise<void> | void
}) {
  const [config, setConfig] = useState<CommerceProductConfig | null>(null)
  const [catalog, setCatalog] = useState<CommerceCatalog>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [seriesId, setSeriesId] = useState('')
  const [modelId, setModelId] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [indexPolicy, setIndexPolicy] = useState<CommerceIndexPolicy>('INDEX')
  const [merchantEnabled, setMerchantEnabled] = useState(false)
  const [merchantItemCondition, setMerchantItemCondition] = useState<MerchantItemCondition>('USED')
  const [googleProductCategory, setGoogleProductCategory] = useState('')
  const [gtin, setGtin] = useState('')
  const [mpn, setMpn] = useState('')
  const [storeWarrantyDays, setStoreWarrantyDays] = useState('')
  const [storeWarrantyTerms, setStoreWarrantyTerms] = useState('')

  const [newSeriesName, setNewSeriesName] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelCode, setNewModelCode] = useState('')
  const isAdmin = ['owner', 'admin'].includes(profile.role)

  function hydrate(next: CommerceProductConfig) {
    setConfig(next)
    setCategoryId(next.categoryId || '')
    setBrandId(next.brandId || '')
    setSeriesId(next.seriesId || '')
    setModelId(next.modelId || '')
    setSeoTitle(next.seoTitle || '')
    setSeoDescription(next.seoDescription || '')
    setIndexPolicy(next.indexPolicy || 'INDEX')
    setMerchantEnabled(Boolean(next.merchantEnabled))
    setMerchantItemCondition(next.merchantItemCondition || 'USED')
    setGoogleProductCategory(next.googleProductCategory || '')
    setGtin(next.gtin || '')
    setMpn(next.mpn || '')
    setStoreWarrantyDays(next.storeWarrantyDays === undefined || next.storeWarrantyDays === null ? '' : String(next.storeWarrantyDays))
    setStoreWarrantyTerms(next.storeWarrantyTerms || '')
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [nextConfig, nextCatalog] = await Promise.all([
        prepareCommerceProduct(product.id),
        getCommerceCatalog(),
      ])
      setCatalog(nextCatalog)
      hydrate(nextConfig)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [product.id])

  const seriesOptions = useMemo(() => catalog.series.filter((item) => (
    (!categoryId || item.categoryId === categoryId) && (!brandId || item.brandId === brandId)
  )), [catalog.series, categoryId, brandId])

  const modelOptions = useMemo(() => catalog.models.filter((item) => (
    (!categoryId || item.categoryId === categoryId)
    && (!brandId || item.brandId === brandId)
    && (!seriesId || item.seriesId === seriesId)
  )), [catalog.models, categoryId, brandId, seriesId])

  function changeCategory(value: string) {
    setCategoryId(value)
    setSeriesId('')
    setModelId('')
  }

  function changeBrand(value: string) {
    setBrandId(value)
    setSeriesId('')
    setModelId('')
  }

  function changeSeries(value: string) {
    setSeriesId(value)
    setModelId('')
  }

  async function save() {
    if (!validateGtin(gtin)) {
      setError('GTIN ไม่ผ่าน checksum หรือความยาวไม่ใช่ 8 / 12 / 13 / 14 หลัก')
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await updateCommerceProduct(product.id, {
        categoryId: categoryId || null,
        brandId: brandId || null,
        seriesId: seriesId || null,
        modelId: modelId || null,
        seoTitle: nullable(seoTitle),
        seoDescription: nullable(seoDescription),
        indexPolicy,
        merchantEnabled,
        merchantItemCondition,
        googleProductCategory: nullable(googleProductCategory),
        gtin: nullable(gtin.replace(/\s+/g, '')),
        mpn: nullable(mpn),
        storeWarrantyDays: storeWarrantyDays.trim() ? Number(storeWarrantyDays) : null,
        storeWarrantyTerms: nullable(storeWarrantyTerms),
      })
      hydrate(next)
      setMessage('บันทึก Commerce configuration แล้ว')
      await onSaved?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function addSeries() {
    if (!categoryId || !brandId || !newSeriesName.trim()) {
      setError('เลือก Category + Brand และใส่ชื่อ Series ก่อน')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await createCommerceSeries({ categoryId, brandId, name: newSeriesName.trim() })
      const nextCatalog = await getCommerceCatalog()
      setCatalog(nextCatalog)
      setSeriesId(created.id)
      setModelId('')
      setNewSeriesName('')
      setMessage(`เพิ่ม Series “${created.name}” แล้ว — ค่าเริ่มต้นเป็น HOLD`) 
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function addModel() {
    if (!categoryId || !brandId || !newModelName.trim()) {
      setError('เลือก Category + Brand และใส่ชื่อ Model ก่อน')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await createCommerceModel({
        categoryId,
        brandId,
        seriesId: seriesId || null,
        name: newModelName.trim(),
        code: newModelCode.trim() || undefined,
      })
      const nextCatalog = await getCommerceCatalog()
      setCatalog(nextCatalog)
      if (created.seriesId) setSeriesId(created.seriesId)
      setModelId(created.id)
      setNewModelName('')
      setNewModelCode('')
      setMessage(`เพิ่ม Model “${created.name}” แล้ว — Evergreen page ยัง HOLD จนกว่าจะทำ SEO content พร้อม`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const canonical = canonicalShopUrl(config)
  const onlyCheckoutBlock = Boolean(config?.dataReady)
    && config?.blockers?.length === 1
    && config.blockers[0] === 'PURCHASE_FLOW_DISABLED'

  return <div className="modal-backdrop commerce-modal-backdrop"><div className="modal-sheet commerce-editor-sheet">
    <div className="modal-head commerce-modal-head">
      <div><p className="eyebrow">SHOP COMMERCE</p><h2>ตั้งค่าหน้าสินค้า</h2><small>{product.sku} · {product.title}</small></div>
      <button className="icon-btn" onClick={onClose}><X/></button>
    </div>

    {loading ? <div className="publish-loading"><LoaderCircle className="spin"/><span>กำลัง Prepare Commerce Listing</span></div> : <>
      {error && <div className="publish-error">{error}</div>}
      {message && <div className="publish-message">{message}</div>}

      <section className="commerce-readiness-card">
        <div className="commerce-readiness-head"><div><strong>Canonical Shop URL</strong><code>{canonicalPathLabel(config)}</code></div><span className={config?.dataReady ? 'ready' : 'hold'}>{config?.dataReady ? 'SEO DATA READY' : 'NEEDS DATA'}</span></div>
        {canonical && <div className="commerce-url-actions"><button onClick={() => void navigator.clipboard.writeText(canonical)}><ClipboardCopy size={16}/>ก๊อป URL</button><button onClick={() => window.open(canonical, '_blank', 'noopener,noreferrer')}><ExternalLink size={16}/>เปิดหน้า</button></div>}
        <div className="commerce-readiness-row"><span>{config?.merchantActivationReady ? <CheckCircle2/> : <ShieldCheck/>}</span><div><strong>{config?.merchantActivationReady ? 'Merchant activation ready' : onlyCheckoutBlock ? 'ข้อมูลสินค้า Merchant พร้อม — Checkout ยังปิดอยู่' : 'Merchant ยังมี blocker'}</strong><small>Merchant Offer จะเปิดเมื่อ Checkout ของร้านเปิด และ SKU นี้ผ่าน readiness gate ครบ</small></div></div>
        {!!config?.blockers?.length && <div className="commerce-blockers">{config.blockers.map((item) => <span key={item}>{merchantBlockerLabel(item)}</span>)}</div>}
      </section>

      <section className="commerce-section">
        <div className="commerce-section-title"><Tags/><div><strong>Taxonomy</strong><small>Category → Brand → Series → Model</small></div></div>
        <div className="commerce-form-grid two">
          <label><span>Category</span><select value={categoryId} onChange={(e) => changeCategory(e.target.value)}><option value="">— ไม่ระบุ —</option>{catalog.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Brand</span><select value={brandId} onChange={(e) => changeBrand(e.target.value)}><option value="">— ไม่ระบุ —</option>{catalog.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Series</span><select value={seriesId} onChange={(e) => changeSeries(e.target.value)}><option value="">— ไม่ระบุ —</option>{seriesOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Model</span><select value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">— ไม่ระบุ —</option>{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` (${item.code})` : ''}</option>)}</select></label>
        </div>
        {isAdmin && <div className="commerce-quick-create">
          <div><input value={newSeriesName} onChange={(e) => setNewSeriesName(e.target.value)} placeholder="ชื่อ Series ใหม่ เช่น TUF Gaming"/><button onClick={() => void addSeries()} disabled={saving}>+ Series</button></div>
          <div><input value={newModelName} onChange={(e) => setNewModelName(e.target.value)} placeholder="ชื่อ Model ใหม่"/><input value={newModelCode} onChange={(e) => setNewModelCode(e.target.value)} placeholder="Model code (ถ้ามี)"/><button onClick={() => void addModel()} disabled={saving}>+ Model</button></div>
          <small>Series/Model ใหม่เริ่มต้นเป็น HOLD เพื่อไม่ให้ระบบสร้างหน้า SEO บาง ๆ อัตโนมัติ</small>
        </div>}
      </section>

      <section className="commerce-section">
        <div className="commerce-section-title"><PackageSearch/><div><strong>Product SEO</strong><small>ควบคุมหน้าสินค้า SKU โดยไม่เปลี่ยน stable slug</small></div></div>
        <label className="commerce-field"><span>SEO Title</span><input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={180}/><small>{seoTitle.length}/180</small></label>
        <label className="commerce-field"><span>Meta Description</span><textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={300} rows={3}/><small>{seoDescription.length}/300</small></label>
        <label className="commerce-field"><span>Index policy</span><select value={indexPolicy} onChange={(e) => setIndexPolicy(e.target.value as CommerceIndexPolicy)}><option value="INDEX">INDEX</option><option value="NOINDEX">NOINDEX</option><option value="HOLD">HOLD</option><option value="RETIRED">RETIRED</option></select></label>
      </section>

      <section className="commerce-section">
        <div className="commerce-section-title"><ShieldCheck/><div><strong>Merchant item data</strong><small>ค่าที่ใช้เตรียม Google Merchant / structured data</small></div></div>
        <div className="commerce-form-grid two">
          <label><span>Condition</span><select value={merchantItemCondition} onChange={(e) => setMerchantItemCondition(e.target.value as MerchantItemCondition)}><option value="USED">Used — มือสอง</option><option value="REFURBISHED">Refurbished — ผ่านการปรับสภาพตามเกณฑ์</option><option value="NEW">New — ใหม่จริง</option></select></label>
          <label className="toggle-field"><span>เตรียม Merchant สำหรับ SKU</span><input type="checkbox" checked={merchantEnabled} onChange={(e) => setMerchantEnabled(e.target.checked)}/></label>
          <label><span>Google product category</span><input value={googleProductCategory} onChange={(e) => setGoogleProductCategory(e.target.value)} placeholder="เช่น Electronics > Computers > Laptops"/></label>
          <label><span>GTIN</span><input value={gtin} onChange={(e) => setGtin(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="ถ้ามีจากผู้ผลิต"/><small className={!validateGtin(gtin) ? 'field-error' : ''}>{gtin && !validateGtin(gtin) ? 'GTIN ไม่ผ่าน checksum' : 'ของมือสองไม่บังคับ ถ้าไม่มี GTIN จริงให้เว้นว่าง'}</small></label>
          <label><span>MPN</span><input value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="Manufacturer Part Number ถ้ามี"/></label>
          <label><span>ประกันร้านเฉพาะ SKU (วัน)</span><input type="number" min="0" max="3650" value={storeWarrantyDays} onChange={(e) => setStoreWarrantyDays(e.target.value)} placeholder="เว้นว่าง = ใช้ค่ากลางร้าน"/></label>
          <label className="span-two"><span>เงื่อนไขประกันเฉพาะ SKU</span><textarea rows={2} value={storeWarrantyTerms} onChange={(e) => setStoreWarrantyTerms(e.target.value)} placeholder="เว้นว่าง = ใช้เงื่อนไขประกันกลางของร้าน"/></label>
        </div>
        <div className="commerce-policy-note"><AlertTriangle size={17}/><span>สินค้ามีรอย/ตำหนิยังใช้ Condition = USED และแจ้งตำหนิในข้อมูลสินค้าจริง ไม่ส่งค่า “damaged” เป็น Merchant condition</span></div>
      </section>

      <div className="commerce-save-row"><button className="secondary-button" onClick={() => void load()} disabled={saving}><RefreshCw size={17}/>รีโหลด</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={18}/> : <Save size={18}/>}บันทึก Commerce</button></div>
    </>}
  </div></div>
}


const SHOPEE_SOURCE_CATEGORIES: Array<{ value: ProductCategory; label: string }> = [
  { value: 'notebook', label: 'Notebook / Laptop' },
  { value: 'pc', label: 'PC / Desktop' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'smartphone', label: 'Smartphone' },
  { value: 'tablet', label: 'Tablet / iPad' },
  { value: 'camera', label: 'Camera' },
  { value: 'lens', label: 'Lens' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'component', label: 'PC Component' },
  { value: 'gaming', label: 'Gaming / Console' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' },
]

function shopeeCategoryRows(payload: any) {
  const rows = payload?.response?.category_list
  return Array.isArray(rows) ? rows : []
}

function shopeeLogisticRows(payload: any) {
  const rows = payload?.response?.logistics_channel_list
  return Array.isArray(rows) ? rows : []
}

function shopeeAttributeRows(payload: any) {
  const groups = payload?.response?.list
  if (!Array.isArray(groups)) return []
  return groups.flatMap((group: any) =>
    Array.isArray(group?.attribute_tree) ? group.attribute_tree : [],
  )
}

function ShopeeSettingsPanel() {
  const [status, setStatus] = useState<ShopeeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)

  const [categories, setCategories] = useState<any[]>([])
  const [categorySearch, setCategorySearch] = useState('')
  const [logistics, setLogistics] = useState<any[]>([])
  const [attributes, setAttributes] = useState<any[]>([])
  const [sourceCategory, setSourceCategory] = useState<ProductCategory>('notebook')
  const [sourceSubtype, setSourceSubtype] = useState('')
  const [shopeeCategoryId, setShopeeCategoryId] = useState('')
  const [shopeeCategoryName, setShopeeCategoryName] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [selectedLogistics, setSelectedLogistics] = useState<number[]>([])
  const [attributeJson, setAttributeJson] = useState('[]')
  const [dimensionJson, setDimensionJson] = useState('')

  async function reloadStatus() {
    setLoading(true)
    setPanelError(null)
    try {
      setStatus(await getShopeeStatus())
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reloadStatus() }, [])

  const connection = status?.connections?.find((item) => item.status === 'CONNECTED')
    || status?.connections?.[0]
    || null

  const leafCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase()
    return categories
      .filter((item) => !item?.has_children)
      .filter((item) => {
        if (!query) return true
        return String(item?.display_category_name || item?.original_category_name || '')
          .toLowerCase()
          .includes(query)
          || String(item?.category_id || '').includes(query)
      })
      .slice(0, 120)
  }, [categories, categorySearch])

  const enabledLogistics = useMemo(
    () => logistics.filter((item) => item?.enabled),
    [logistics],
  )

  const mandatoryAttributes = useMemo(
    () => attributes.filter((item) => item?.mandatory),
    [attributes],
  )

  async function connect() {
    setBusy(true)
    setPanelError(null)
    try {
      const result = await startShopeeAuthorization()
      window.location.assign(result.authorizationUrl)
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function loadDiscovery() {
    if (!connection) return
    setBusy(true)
    setPanelError(null)
    setNotice(null)
    try {
      const [categoryResult, logisticResult] = await Promise.all([
        discoverShopee(connection.shopId, 'categories'),
        discoverShopee(connection.shopId, 'logistics'),
      ])
      const nextCategories = shopeeCategoryRows(categoryResult)
      const nextLogistics = shopeeLogisticRows(logisticResult)
      setCategories(nextCategories)
      setLogistics(nextLogistics)
      setSelectedLogistics(
        nextLogistics
          .filter((item: any) => item?.enabled && item?.fee_type !== 'SIZE_SELECTION')
          .map((item: any) => Number(item.logistics_channel_id))
          .filter((value: number) => Number.isInteger(value) && value > 0),
      )
      setNotice(`โหลดจาก Shopee แล้ว: ${nextCategories.length} หมวด / ${nextLogistics.length} ช่องทางขนส่ง`)
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function chooseCategory(value: string) {
    setShopeeCategoryId(value)
    const selected = categories.find((item) => String(item?.category_id) === value)
    setShopeeCategoryName(
      String(selected?.display_category_name || selected?.original_category_name || ''),
    )
    setAttributes([])
    setAttributeJson('[]')
    if (!connection || !value) return
    try {
      const result = await discoverShopee(
        connection.shopId,
        'attributes',
        [Number(value)],
      )
      setAttributes(shopeeAttributeRows(result))
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveMapping() {
    if (!connection) return
    const categoryId = Number(shopeeCategoryId)
    const weight = Number(weightKg)
    if (!categoryId || !weight || !selectedLogistics.length) {
      setPanelError('เลือก Shopee category, น้ำหนัก และช่องทางขนส่งอย่างน้อย 1 รายการก่อน')
      return
    }

    setBusy(true)
    setPanelError(null)
    setNotice(null)
    try {
      const attributeList = JSON.parse(attributeJson || '[]')
      const dimension = dimensionJson.trim()
        ? JSON.parse(dimensionJson)
        : null
      if (!Array.isArray(attributeList)) {
        throw new Error('Attribute JSON ต้องเป็น array')
      }
      const result = await saveShopeeCategoryMapping({
        sourceCategory,
        sourceSubtype: sourceSubtype.trim() || null,
        shopeeCategoryId: categoryId,
        shopeeCategoryName: shopeeCategoryName || null,
        attributeList,
        logisticInfo: selectedLogistics.map((logisticId) => ({
          logistic_id: logisticId,
          enabled: true,
        })),
        weightKg: weight,
        dimension,
      })
      setNotice(`บันทึก mapping แล้ว • เพิ่มคิวอัตโนมัติ ${result.queued} รายการ`)
      await reloadStatus()
    } catch (err) {
      setPanelError(
        err instanceof SyntaxError
          ? 'JSON ของ Attribute/Dimension ไม่ถูกต้อง'
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  async function seed() {
    if (!connection) return
    setBusy(true)
    setPanelError(null)
    try {
      const result = await seedShopeeQueue(connection.shopId)
      setNotice(`ตรวจสินค้าปัจจุบันแล้ว • เข้า queue ใหม่ ${result.queued} รายการ`)
      await reloadStatus()
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggleLogistic(id: number) {
    setSelectedLogistics((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    )
  }

  return <section className="commerce-section shopee-settings-panel">
    <div className="commerce-section-title">
      <ExternalLink/>
      <div>
        <strong>Shopee Seller API</strong>
        <small>AMPHON System เป็นเจ้าของสต๊อก • Shopee เป็นช่องทางขายภายนอกเท่านั้น</small>
      </div>
    </div>

    {loading ? <div className="publish-loading"><LoaderCircle className="spin"/><span>กำลังตรวจ Shopee API</span></div> : <>
      {panelError && <div className="publish-error">{panelError}</div>}
      {notice && <div className="publish-message">{notice}</div>}

      <div className="commerce-lock-card">
        <ShieldCheck/>
        <div>
          <strong>
            {status?.mode === 'disabled'
              ? 'Shopee Manual ใช้งานได้ — Direct API ยังปิดไว้'
              : status?.mode === 'partner_api'
                ? 'Shopee ใช้โหมด Partner API — รอเชื่อม Provider'
                : !status?.configured
                  ? 'Shopee Direct API เปิดโหมดแล้ว แต่ยังไม่มี Partner credentials'
                  : connection
                    ? `เชื่อม Shopee Shop ${connection.shopId} แล้ว`
                    : 'Shopee Direct API พร้อม — รอ authorize ร้าน'}
          </strong>
          <small>
            {connection
              ? `สถานะ ${connection.status} • mapping ${status?.mappings?.categories ?? 0} หมวด • ลงแล้ว ${status?.mappings?.publishedProducts ?? 0} SKU • queue ${status?.queue?.pending ?? 0} • error ${status?.queue?.failed ?? 0}`
              : status?.mode === 'disabled'
                ? 'พนักงานลง Shopee ผ่าน Sales Toolkit ได้ โดยระบบช่วยเตรียมราคา +18% ตายตัว ส่วน Direct API ยังไม่ยิงอัตโนมัติ'
                : 'Partner key และ token อยู่ฝั่ง server เท่านั้น ไม่ส่งเข้า browser'}
          </small>
        </div>
      </div>

      {status?.mode === 'direct_api' && status?.configured && !connection && (
        <button className="primary-button" type="button" onClick={() => void connect()} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18}/> : <ExternalLink size={18}/>}
          เชื่อมร้าน Shopee
        </button>
      )}

      {connection && <>
        <div className="commerce-save-row">
          <button className="secondary-button" type="button" onClick={() => void loadDiscovery()} disabled={busy}>
            <RefreshCw size={17}/>โหลด Category / Logistics จาก Shopee
          </button>
          <button className="secondary-button" type="button" onClick={() => void seed()} disabled={busy}>
            <PackageSearch size={17}/>ตรวจและเข้าคิวสินค้าปัจจุบัน
          </button>
        </div>

        {!!categories.length && <div className="shopee-mapping-box">
          <strong>ตั้ง Mapping สำหรับ Auto Publish</strong>
          <small>ทำครั้งเดียวต่อ AMPHON category/subtype แล้วสินค้าใหม่ใช้ mapping นี้อัตโนมัติ</small>

          <div className="commerce-form-grid two">
            <label>
              <span>AMPHON category</span>
              <select value={sourceCategory} onChange={(e) => setSourceCategory(e.target.value as ProductCategory)}>
                {SHOPEE_SOURCE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>Subtype (ถ้าต้องแยก)</span>
              <input value={sourceSubtype} onChange={(e) => setSourceSubtype(e.target.value)} placeholder="เว้นว่าง = ใช้ทั้งหมวด"/>
            </label>
            <label className="span-two">
              <span>ค้นหา Shopee category</span>
              <input value={categorySearch} onChange={(e) => setCategorySearch(e.target.value)} placeholder="เช่น Laptop / Notebook / โทรศัพท์"/>
            </label>
            <label className="span-two">
              <span>Shopee category — ต้องเป็น leaf category</span>
              <select value={shopeeCategoryId} onChange={(e) => void chooseCategory(e.target.value)}>
                <option value="">— เลือกหมวด —</option>
                {leafCategories.map((item) => <option key={item.category_id} value={item.category_id}>
                  {item.display_category_name || item.original_category_name} · {item.category_id}
                </option>)}
              </select>
            </label>
            <label>
              <span>น้ำหนักพัสดุ (kg)</span>
              <input type="number" min="0.01" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="เช่น 2.5"/>
            </label>
            <label>
              <span>Dimension JSON (ถ้าต้องใช้)</span>
              <input value={dimensionJson} onChange={(e) => setDimensionJson(e.target.value)} placeholder='{"package_length":40,"package_width":30,"package_height":10}'/>
            </label>
          </div>

          <div className="shopee-logistics">
            <strong>ช่องทางขนส่งที่เปิดในร้าน</strong>
            {enabledLogistics.map((item) => {
              const id = Number(item.logistics_channel_id)
              return <label key={id} className="toggle-field wide">
                <span>{item.logistics_channel_name} <small>{item.fee_type || ''}</small></span>
                <input type="checkbox" checked={selectedLogistics.includes(id)} onChange={() => toggleLogistic(id)}/>
              </label>
            })}
          </div>

          {!!shopeeCategoryId && <label className="commerce-field">
            <span>Required attributes ของหมวดนี้</span>
            <small>
              {mandatoryAttributes.length
                ? mandatoryAttributes.map((item) => `${item.name} (#${item.attribute_id})`).join(' • ')
                : 'Shopee ไม่รายงาน mandatory attribute หรือยังโหลดไม่สำเร็จ'}
            </small>
            <textarea rows={4} value={attributeJson} onChange={(e) => setAttributeJson(e.target.value)} placeholder='[{"attribute_id":123,"attribute_value_list":[{"value_id":456,"original_value_name":"..."}]}]'/>
            <small>ใส่เฉพาะค่า attribute ที่ Shopee ต้องการตาม Attribute Tree; ถ้าไม่มีให้ใช้ []</small>
          </label>}

          <button className="primary-button" type="button" onClick={() => void saveMapping()} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18}/> : <Save size={18}/>}
            บันทึก Mapping + เริ่ม Auto Publish
          </button>
        </div>}
      </>}
    </>}
  </section>
}

export function MerchantSettingsModal({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [tab, setTab] = useState<'policy' | 'taxonomy'>('policy')
  const [settings, setSettings] = useState<CommerceStoreSettings | null>(null)
  const [candidates, setCandidates] = useState<CommerceTaxonomyCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const isAdmin = ['owner', 'admin'].includes(profile.role)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [nextSettings, nextCandidates] = await Promise.all([
        getCommerceStoreSettings(),
        isAdmin ? listCommerceTaxonomyCandidates() : Promise.resolve([]),
      ])
      setSettings(nextSettings)
      setCandidates(nextCandidates)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function patchStore(patch: Partial<CommerceStoreSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : current)
  }

  function patchAutoPublish(patch: Partial<NonNullable<CommerceStoreSettings['autoPublish']>>) {
    setSettings((current) => current ? {
      ...current,
      autoPublish: {
        enabled: current.autoPublish?.enabled ?? true,
        delaySeconds: current.autoPublish?.delaySeconds ?? 180,
        ...patch,
      },
    } : current)
  }

  function patchShipping(patch: Partial<CommerceStoreSettings['shipping']>) {
    setSettings((current) => current ? { ...current, shipping: { ...current.shipping, ...patch } } : current)
  }

  function patchReturns(patch: Partial<CommerceStoreSettings['returns']>) {
    setSettings((current) => current ? { ...current, returns: { ...current.returns, ...patch } } : current)
  }

  function patchCheckout(patch: Partial<CommerceStoreSettings['checkout']>) {
    setSettings((current) => current ? { ...current, checkout: { ...current.checkout, ...patch } } : current)
  }

  function patchWarranty(patch: Partial<CommerceStoreSettings['warranty']>) {
    setSettings((current) => current ? { ...current, warranty: { ...current.warranty, ...patch } } : current)
  }

  function patchDocuments(patch: Partial<CommerceStoreSettings['documents']>) {
    setSettings((current) => current ? { ...current, documents: { ...current.documents, ...patch } } : current)
  }

  async function save() {
    if (!settings || !isAdmin) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await updateCommerceStoreSettings(settings)
      setSettings(next)
      setMessage('บันทึก Auto Publish / Checkout / Merchant / Shipping / Return configuration แล้ว')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function remap() {
    if (!isAdmin) return
    setSaving(true)
    setError(null)
    try {
      const affected = await refreshCommerceMappings()
      setMessage(`Remap taxonomy แล้ว ${affected} สินค้า`)
      setCandidates(await listCommerceTaxonomyCandidates())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return <div className="modal-backdrop commerce-modal-backdrop"><div className="modal-sheet commerce-settings-sheet">
    <div className="modal-head commerce-modal-head"><div><p className="eyebrow">SHOP ADMIN</p><h2>Merchant Configuration</h2><small>ค่ากลางของ shop.amphon.co.th</small></div><button className="icon-btn" onClick={onClose}><X/></button></div>
    <div className="commerce-tabs"><button className={tab === 'policy' ? 'active' : ''} onClick={() => setTab('policy')}><Settings2/>ร้าน / จัดส่ง / คืนสินค้า</button><button className={tab === 'taxonomy' ? 'active' : ''} onClick={() => setTab('taxonomy')}><Tags/>Taxonomy Candidates</button></div>

    {loading ? <div className="publish-loading"><LoaderCircle className="spin"/><span>กำลังโหลด Commerce settings</span></div> : <>
      {error && <div className="publish-error">{error}</div>}
      {message && <div className="publish-message">{message}</div>}

      {tab === 'policy' && settings && <div className="commerce-settings-body">
        {!isAdmin && <div className="publish-readonly">ดูได้อย่างเดียว — Owner/Admin เท่านั้นที่แก้ Merchant Configuration ได้</div>}
        <section className="commerce-section">
          <div className="commerce-section-title"><ShieldCheck/><div><strong>Merchant identity</strong><small>ไม่มี credential หรือข้อมูลการเงินอยู่ในตารางนี้</small></div></div>
          <div className="commerce-form-grid two">
            <label><span>Merchant name</span><input value={settings.merchantName} onChange={(e) => patchStore({ merchantName: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>Legal name</span><input value={settings.legalName || ''} onChange={(e) => patchStore({ legalName: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>Shop URL</span><input value={settings.siteUrl} onChange={(e) => patchStore({ siteUrl: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>Currency / Country</span><input value={`${settings.currency} / ${settings.countryCode}`} disabled/></label>
          </div>
          <div className={settings.purchaseEnabled ? 'commerce-lock-card checkout-live' : 'commerce-lock-card'}><ShieldCheck/><div><strong>{settings.purchaseEnabled ? 'Purchase flow: LIVE' : 'Purchase flow: OFF'}</strong><small>เปิดได้เมื่อ Shipping + Return policy + Turnstile และอย่างน้อยหนึ่งช่องทางชำระเงินจริงพร้อม ระบบ Order ล็อก SKU แบบ atomic ที่ฐานข้อมูล</small></div></div>
        </section>

        {isAdmin && <ShopeeSettingsPanel />}

        <section className="commerce-section auto-publish-config">
          <div className="commerce-section-title"><CheckCircle2/><div><strong>ลงสินค้าในเว็บไซต์อัตโนมัติ</strong><small>เมื่อรูป สเปก และข้อมูลขายครบ ระบบจะรอให้ข้อมูลนิ่งก่อนขึ้น AMPHON SHOP เอง</small></div></div>
          <label className="toggle-field wide"><span>เปิด Auto Publish ไป AMPHON SHOP</span><input type="checkbox" checked={settings.autoPublish?.enabled ?? true} onChange={(e) => patchAutoPublish({ enabled: e.target.checked })} disabled={!isAdmin}/></label>
          <div className="commerce-form-grid two">
            <label><span>รอหลังพร้อมครบ (นาที)</span><input type="number" min="1" max="60" value={Math.round((settings.autoPublish?.delaySeconds ?? 180) / 60)} onChange={(e) => patchAutoPublish({ delaySeconds: Math.max(60, Math.min(Number(e.target.value || 3) * 60, 3600)) })} disabled={!isAdmin || !(settings.autoPublish?.enabled ?? true)}/></label>
            <label><span>ค่าแนะนำ</span><input value="3 นาที — กันข้อมูลระหว่างแก้ไข" disabled/></label>
          </div>
          <div className="commerce-policy-note"><ShieldCheck size={17}/><span>ใช้ readiness เดิมของ Hub: ต้องมีรูปพร้อม cover + สเปกครบ + ข้อมูลลงขายครบ ระบบนี้ไม่แก้สถานะสต๊อกของ AMPHON System</span></div>
        </section>

        <section className="commerce-section">
          <div className="commerce-section-title"><CheckCircle2/><div><strong>Checkout & Reservation</strong><small>ค่าที่ใช้กับ Cart → Checkout → Order โดยตรง</small></div></div>
          <label className="toggle-field wide"><span>เปิด Checkout ออนไลน์ / Merchant Offer</span><input type="checkbox" checked={settings.purchaseEnabled} onChange={(e) => patchStore({ purchaseEnabled: e.target.checked })} disabled={!isAdmin}/></label>
          <div className="commerce-form-grid two">
            <label><span>ล็อกสินค้า (นาที)</span><input type="number" min={settings.checkout.stripeEnabled ? 45 : 10} max="240" value={settings.checkout.reservationMinutes} onChange={(e) => patchCheckout({ reservationMinutes: Number(e.target.value || 60) })} disabled={!isAdmin}/></label>
            <label><span>Checkout terms URL</span><input value={settings.checkout.termsUrl || ''} onChange={(e) => patchCheckout({ termsUrl: e.target.value })} placeholder="https://shop.amphon.co.th/..." disabled={!isAdmin}/></label>
          </div>
          <label className="toggle-field wide"><span>รับชำระผ่าน Stripe Checkout</span><input type="checkbox" checked={settings.checkout.stripeEnabled} onChange={(e) => patchCheckout({ stripeEnabled: e.target.checked, promptPayEnabled: e.target.checked ? settings.checkout.promptPayEnabled : false })} disabled={!isAdmin}/></label>
          <label className="toggle-field wide"><span>เปิด PromptPay ผ่าน Stripe (THB)</span><input type="checkbox" checked={settings.checkout.promptPayEnabled} onChange={(e) => patchCheckout({ promptPayEnabled: e.target.checked })} disabled={!isAdmin || !settings.checkout.stripeEnabled}/></label>
          <div className="commerce-policy-note"><ShieldCheck size={17}/><span>Stripe secret และ webhook secret ไม่เก็บใน UI/ฐานข้อมูล — ตั้งเป็น Worker secrets เท่านั้น</span></div>
          <label className="toggle-field wide"><span>บังคับ Cloudflare Turnstile ก่อนล็อกสต๊อก</span><input type="checkbox" checked={settings.checkout.turnstileEnabled} onChange={(e) => patchCheckout({ turnstileEnabled: e.target.checked })} disabled={!isAdmin}/></label>
          <label className="wide"><span>Turnstile site key (Public)</span><input value={settings.checkout.turnstileSiteKey || ''} onChange={(e) => patchCheckout({ turnstileSiteKey: e.target.value })} placeholder="0x4AAAA..." disabled={!isAdmin || !settings.checkout.turnstileEnabled}/><small>Secret key ห้ามใส่ตรงนี้ — ตั้งที่ Worker ด้วย `wrangler secret put TURNSTILE_SECRET_KEY`</small></label>
          <label className="toggle-field wide"><span>รับชำระด้วยการโอนเงิน</span><input type="checkbox" checked={settings.checkout.bankTransferEnabled} onChange={(e) => patchCheckout({ bankTransferEnabled: e.target.checked })} disabled={!isAdmin}/></label>
          <div className="commerce-form-grid two">
            <label><span>ธนาคาร</span><input value={settings.checkout.bankName || ''} onChange={(e) => patchCheckout({ bankName: e.target.value })} disabled={!isAdmin || !settings.checkout.bankTransferEnabled}/></label>
            <label><span>ชื่อบัญชี</span><input value={settings.checkout.bankAccountName || ''} onChange={(e) => patchCheckout({ bankAccountName: e.target.value })} disabled={!isAdmin || !settings.checkout.bankTransferEnabled}/></label>
            <label className="span-two"><span>เลขบัญชี</span><input value={settings.checkout.bankAccountNumber || ''} onChange={(e) => patchCheckout({ bankAccountNumber: e.target.value })} disabled={!isAdmin || !settings.checkout.bankTransferEnabled}/></label>
          </div>
          <label className="toggle-field wide"><span>อนุญาตรับสินค้าที่ร้าน</span><input type="checkbox" checked={settings.checkout.pickupEnabled} onChange={(e) => patchCheckout({ pickupEnabled: e.target.checked })} disabled={!isAdmin}/></label>
          <label className="toggle-field wide"><span>อนุญาตชำระที่ร้าน (เฉพาะ Pickup)</span><input type="checkbox" checked={settings.checkout.payAtStoreEnabled} onChange={(e) => patchCheckout({ payAtStoreEnabled: e.target.checked })} disabled={!isAdmin || !settings.checkout.pickupEnabled}/></label>
        </section>

        <section className="commerce-section">
          <div className="commerce-section-title"><ShieldCheck/><div><strong>Receipt / Invoice & Warranty</strong><small>ข้อมูล snapshot ณ เวลาขาย ไม่เปลี่ยนสิทธิ์ย้อนหลัง</small></div></div>
          <div className="commerce-form-grid two">
            <label><span>Document mode</span><select value={settings.documents.mode} onChange={(e) => patchDocuments({ mode: e.target.value as CommerceStoreSettings['documents']['mode'] })} disabled={!isAdmin}><option value="RECEIPT_ONLY">Receipt only</option><option value="INVOICE_RECEIPT">Invoice / Receipt</option><option value="VAT_TAX_INVOICE">VAT Tax Invoice</option></select></label>
            <label><span>ประกันร้านค่าเริ่มต้น (วัน)</span><input type="number" min="0" max="3650" value={settings.warranty.defaultDays} onChange={(e) => patchWarranty({ defaultDays: Number(e.target.value || 0) })} disabled={!isAdmin}/></label>
            <label className="span-two"><span>เงื่อนไขประกันค่าเริ่มต้น</span><textarea rows={2} value={settings.warranty.defaultTerms || ''} onChange={(e) => patchWarranty({ defaultTerms: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>ชื่อผู้ขายบนเอกสาร</span><input value={settings.documents.sellerName || ''} onChange={(e) => patchDocuments({ sellerName: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>เลขประจำตัวผู้เสียภาษี</span><input value={settings.documents.taxId || ''} onChange={(e) => patchDocuments({ taxId: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>สาขา</span><input value={settings.documents.branchCode || ''} onChange={(e) => patchDocuments({ branchCode: e.target.value })} disabled={!isAdmin}/></label>
            <label><span>อีเมลเอกสาร</span><input value={settings.documents.email || ''} onChange={(e) => patchDocuments({ email: e.target.value })} disabled={!isAdmin}/></label>
            <label className="span-two"><span>ที่อยู่ผู้ขาย</span><textarea rows={2} value={settings.documents.address || ''} onChange={(e) => patchDocuments({ address: e.target.value })} disabled={!isAdmin}/></label>
          </div>
          <div className="commerce-policy-note"><AlertTriangle size={17}/><span>โหมด VAT เป็นข้อมูลสำหรับเอกสารในระบบนี้ ไม่ได้อ้างว่าเชื่อม e-Tax Invoice/e-Receipt ของกรมสรรพากรอัตโนมัติ</span></div>
        </section>

        <section className="commerce-section">
          <div className="commerce-section-title"><PackageSearch/><div><strong>Shipping</strong><small>เปิดเฉพาะเมื่อข้อมูลด้านล่างเป็นนโยบายที่ร้านใช้จริง</small></div></div>
          <label className="toggle-field wide"><span>ประกาศ Shipping policy ใน structured data</span><input type="checkbox" checked={settings.shipping.enabled} onChange={(e) => patchShipping({ enabled: e.target.checked })} disabled={!isAdmin}/></label>
          <div className="commerce-form-grid two">
            <label><span>ประเทศ</span><input value={settings.shipping.country} onChange={(e) => patchShipping({ country: e.target.value.toUpperCase().slice(0, 2) })} disabled={!isAdmin}/></label>
            <label><span>ค่าจัดส่ง (บาท)</span><input type="number" min="0" value={settings.shipping.rate ?? ''} onChange={(e) => patchShipping({ rate: numberValue(e.target.value) })} disabled={!isAdmin}/></label>
            <label><span>Handling min / max วัน</span><div className="inline-number-pair"><input type="number" min="0" value={settings.shipping.handlingMinDays ?? ''} onChange={(e) => patchShipping({ handlingMinDays: numberValue(e.target.value) })} disabled={!isAdmin}/><input type="number" min="0" value={settings.shipping.handlingMaxDays ?? ''} onChange={(e) => patchShipping({ handlingMaxDays: numberValue(e.target.value) })} disabled={!isAdmin}/></div></label>
            <label><span>Transit min / max วัน</span><div className="inline-number-pair"><input type="number" min="0" value={settings.shipping.transitMinDays ?? ''} onChange={(e) => patchShipping({ transitMinDays: numberValue(e.target.value) })} disabled={!isAdmin}/><input type="number" min="0" value={settings.shipping.transitMaxDays ?? ''} onChange={(e) => patchShipping({ transitMaxDays: numberValue(e.target.value) })} disabled={!isAdmin}/></div></label>
            <label className="span-two"><span>Shipping policy URL</span><input value={settings.shipping.policyUrl || ''} onChange={(e) => patchShipping({ policyUrl: e.target.value })} placeholder="https://shop.amphon.co.th/..." disabled={!isAdmin}/></label>
          </div>
        </section>

        <section className="commerce-section">
          <div className="commerce-section-title"><RefreshCw/><div><strong>Return policy</strong><small>Store-wide policy — product override ค่อยทำเมื่อมีเหตุผลเฉพาะ SKU</small></div></div>
          <label className="toggle-field wide"><span>ประกาศ Return policy ใน structured data</span><input type="checkbox" checked={settings.returns.enabled} onChange={(e) => patchReturns({ enabled: e.target.checked })} disabled={!isAdmin}/></label>
          <div className="commerce-form-grid two">
            <label><span>Return category</span><select value={settings.returns.category || ''} onChange={(e) => patchReturns({ category: (e.target.value || undefined) as CommerceStoreSettings['returns']['category'] })} disabled={!isAdmin}><option value="">— เลือก —</option><option value="FINITE">คืนได้ภายในกำหนด</option><option value="NOT_PERMITTED">ไม่รับคืน</option><option value="UNLIMITED">ไม่จำกัดเวลา</option></select></label>
            <label><span>จำนวนวัน (FINITE)</span><input type="number" min="0" value={settings.returns.days ?? ''} onChange={(e) => patchReturns({ days: numberValue(e.target.value) })} disabled={!isAdmin || settings.returns.category !== 'FINITE'}/></label>
            <label><span>วิธีคืน</span><select value={settings.returns.method || ''} onChange={(e) => patchReturns({ method: (e.target.value || undefined) as CommerceStoreSettings['returns']['method'] })} disabled={!isAdmin}><option value="">— เลือก —</option><option value="MAIL">ส่งกลับทางขนส่ง</option><option value="IN_STORE">คืนที่ร้าน</option><option value="MAIL_AND_IN_STORE">ทั้งสองแบบ</option></select></label>
            <label><span>ค่าคืนสินค้า</span><select value={settings.returns.fees || ''} onChange={(e) => patchReturns({ fees: (e.target.value || undefined) as CommerceStoreSettings['returns']['fees'] })} disabled={!isAdmin}><option value="">— เลือก —</option><option value="FREE">ร้านรับผิดชอบ</option><option value="CUSTOMER_RESPONSIBILITY">ลูกค้ารับผิดชอบ</option></select></label>
            <label className="span-two"><span>Return policy URL</span><input value={settings.returns.policyUrl || ''} onChange={(e) => patchReturns({ policyUrl: e.target.value })} disabled={!isAdmin}/></label>
            <label className="span-two"><span>Warranty policy URL</span><input value={settings.warrantyPolicyUrl || ''} onChange={(e) => patchStore({ warrantyPolicyUrl: e.target.value })} disabled={!isAdmin}/></label>
          </div>
        </section>

        {isAdmin && <div className="commerce-save-row"><button className="secondary-button" onClick={() => void load()} disabled={saving}><RefreshCw size={17}/>รีโหลด</button><button className="primary-button" onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spin" size={18}/> : <Save size={18}/>}บันทึก Settings</button></div>}
      </div>}

      {tab === 'taxonomy' && <div className="commerce-settings-body">
        <div className="taxonomy-toolbar"><div><strong>Uncurated / partially mapped stock labels</strong><small>ใช้ข้อมูลจากสินค้าจริง ไม่สร้าง SEO Model Page อัตโนมัติ</small></div>{isAdmin && <button onClick={() => void remap()} disabled={saving}>{saving ? <LoaderCircle className="spin"/> : <RefreshCw/>}Remap ทั้งระบบ</button>}</div>
        <div className="taxonomy-candidate-list">{candidates.slice(0, 80).map((item, index) => <div className="taxonomy-candidate" key={`${item.categoryId}-${item.sourceBrand}-${item.sourceModel}-${index}`}><div><strong>{[item.sourceBrand, item.sourceModel].filter(Boolean).join(' · ') || 'ไม่ระบุชื่อ'}</strong><small>{item.categorySlug || item.categoryKey || 'ไม่มี category'} · ประวัติ {item.historicalListingCount} · มีขาย {item.currentStockCount}</small></div><span className={item.mappedModelId ? 'mapped' : item.mappedBrandId ? 'partial' : 'hold'}>{item.mappedModelId ? 'MODEL MAPPED' : item.mappedBrandId ? 'BRAND ONLY' : 'HOLD'}</span></div>)}</div>
        {!candidates.length && <div className="publish-empty"><CheckCircle2/><strong>ไม่มี candidate ที่ต้องตรวจ</strong><span>เมื่อมี Brand/Model ใหม่จากสต๊อกจริง ระบบจะแสดงที่นี่</span></div>}
      </div>}
    </>}
  </div></div>
}

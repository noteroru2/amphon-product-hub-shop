import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { DuplicateIdentifierMatch, EmployeeActivity, EmployeeSummary, ProductActivity, ProductDraft, ProductImageDraft, ProductStatus, ProductSummary, Profile, UserRole } from '../types/product'
import { validateReadyToList } from './productSchemas'

const r2Api = (import.meta.env.VITE_R2_UPLOAD_API as string | undefined)?.replace(/\/$/, '')

const ACTIVE_INVENTORY_STATUSES: ProductStatus[] = ['draft', 'photo_ready', 'ready_to_list', 'published', 'reserved', 'repair', 'consignment']

export function normalizeIdentifier(value?: string) {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const STATUS_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ['draft', 'photo_ready', 'ready_to_list', 'repair', 'consignment', 'cancelled'],
  photo_ready: ['draft', 'photo_ready', 'ready_to_list', 'repair', 'consignment', 'cancelled'],
  ready_to_list: ['draft', 'photo_ready', 'ready_to_list', 'published', 'reserved', 'sold', 'repair', 'consignment', 'cancelled'],
  published: ['ready_to_list', 'published', 'reserved', 'sold', 'repair', 'cancelled'],
  reserved: ['ready_to_list', 'published', 'reserved', 'sold', 'cancelled'],
  sold: ['sold', 'returned'],
  repair: ['draft', 'photo_ready', 'ready_to_list', 'repair', 'consignment', 'cancelled'],
  consignment: ['draft', 'photo_ready', 'ready_to_list', 'published', 'reserved', 'sold', 'consignment', 'returned', 'cancelled'],
  returned: ['returned'],
  cancelled: ['cancelled'],
}

export function allowedStatuses(current: ProductStatus | undefined, role: UserRole): ProductStatus[] {
  if (!current) return ['draft', 'photo_ready', 'ready_to_list', 'repair', 'consignment']
  const base = STATUS_TRANSITIONS[current] ?? [current]
  if (role === 'owner' || role === 'admin') {
    if (current === 'returned' || current === 'cancelled') return Array.from(new Set([...base, 'draft']))
  }
  return base
}

function client() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  return supabase
}

function canSeeFinancials(role: UserRole) {
  return role === 'owner' || role === 'admin'
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function mapProduct(row: any, financial?: any): ProductSummary {
  const images = [...(row.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id as string,
      objectKey: image.object_key as string,
      publicUrl: image.public_url ?? undefined,
      sortOrder: image.sort_order as number,
      isCover: Boolean(image.is_cover),
      imageRole: image.image_role ?? undefined,
    }))

  return {
    id: row.id,
    sku: row.sku ?? '',
    category: row.category,
    subtype: row.subtype ?? undefined,
    brand: row.brand ?? undefined,
    model: row.model ?? undefined,
    serialNumber: row.serial_number ?? undefined,
    title: row.title,
    price: numberOrUndefined(row.price) ?? 0,
    cost: numberOrUndefined(financial?.cost),
    status: row.status,
    conditionPercent: numberOrUndefined(row.condition_percent),
    warrantyUntil: row.warranty_until ?? undefined,
    defects: row.defects ?? undefined,
    notes: row.notes ?? undefined,
    specs: row.specs ?? {},
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    soldAt: row.sold_at ?? undefined,
  }
}

export async function loadProfile(userId: string): Promise<Profile> {
  const { data, error } = await client().from('profiles').select('id,display_name,role,active').eq('id', userId).single()
  if (error) throw error
  return {
    id: data.id,
    displayName: data.display_name || 'พนักงาน',
    role: data.role as UserRole,
    active: data.active,
  }
}

export async function listProducts(role: UserRole): Promise<ProductSummary[]> {
  const db = client()
  const { data, error } = await db
    .from('products')
    .select('id,sku,category,subtype,brand,model,title,serial_number,status,condition_percent,price,warranty_until,defects,notes,specs,created_at,updated_at,sold_at,product_images(id,object_key,public_url,sort_order,is_cover,image_role)')
    // AMPHON System owns inventory availability. Once System projects SOLD,
    // the item must disappear from normal Hub inventory instead of lingering
    // as a historical product card. NULL keeps legacy/non-ONE records visible.
    .or('one_availability.is.null,one_availability.neq.SOLD')
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) throw error

  let financialById = new Map<string, any>()
  if (canSeeFinancials(role) && data?.length) {
    const ids = data.map((row: any) => row.id)
    const { data: financials, error: financialError } = await db.from('product_financials').select('product_id,cost').in('product_id', ids)
    if (financialError) throw financialError
    financialById = new Map((financials ?? []).map((row: any) => [row.product_id, row]))
  }

  return (data ?? []).map((row: any) => mapProduct(row, financialById.get(row.id)))
}

export async function findDuplicateIdentifier(identifier?: string, excludeProductId?: string): Promise<DuplicateIdentifierMatch | null> {
  const normalized = normalizeIdentifier(identifier)
  if (!normalized) return null
  const db = client()
  const { data, error } = await db.rpc('find_active_product_by_identifier', { identifier_value: identifier ?? '' })
  if (error) throw error
  const row = (data ?? []).find((item: any) => item.id !== excludeProductId)
  if (!row) return null
  return {
    id: String(row.id),
    sku: String(row.sku ?? ''),
    title: String(row.title ?? ''),
    status: row.status as ProductStatus,
    serialNumber: String(row.serial_number ?? ''),
  }
}

export async function listProductActivity(productId: string, limit = 20): Promise<ProductActivity[]> {
  const db = client()
  const { data, error } = await db
    .from('activity_logs')
    .select('id,actor_id,action,metadata,created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error

  const actorIds = Array.from(new Set((data ?? []).map((row: any) => row.actor_id).filter(Boolean))) as string[]
  const names = new Map<string, string>()
  if (actorIds.length) {
    const { data: profiles, error: profileError } = await db.from('profiles').select('id,display_name').in('id', actorIds)
    if (profileError) throw profileError
    for (const profile of profiles ?? []) names.set(String(profile.id), String(profile.display_name || 'พนักงาน'))
  }

  return (data ?? []).map((row: any) => ({
    id: Number(row.id),
    action: String(row.action),
    actorId: row.actor_id ?? undefined,
    actorName: row.actor_id ? names.get(String(row.actor_id)) || 'พนักงาน' : 'ระบบ',
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }))
}

export async function quickChangeProductStatus(productId: string, desiredStatus: ProductStatus, profile: Profile): Promise<ProductSummary> {
  const db = client()
  const { data: existing, error: existingError } = await db
    .from('products')
    .select('status')
    .eq('id', productId)
    .single()
  if (existingError) throw existingError

  const currentStatus = existing.status as ProductStatus
  const allowed = allowedStatuses(currentStatus, profile.role)
  if (!allowed.includes(desiredStatus)) {
    throw new Error(`ไม่อนุญาตให้เปลี่ยนสถานะจาก ${currentStatus} เป็น ${desiredStatus}`)
  }
  if (['ready_to_list', 'published'].includes(desiredStatus)) {
    throw new Error('การเปลี่ยนเป็นพร้อมลงขาย/เผยแพร่ ต้องเปิดสินค้าและตรวจความครบถ้วนก่อน')
  }

  const { error } = await db
    .from('products')
    .update({ status: desiredStatus, updated_by: profile.id })
    .eq('id', productId)
  if (error) throw error

  if (currentStatus !== desiredStatus) {
    await logActivity(productId, 'status_changed', { from: currentStatus, to: desiredStatus, source: 'quick_action' })
    await logActivity(productId, 'quick_status_action', { status: desiredStatus })
  }

  const products = await listProducts(profile.role)
  const saved = products.find((product) => product.id === productId)
  if (!saved) throw new Error('เปลี่ยนสถานะสำเร็จ แต่โหลดสินค้ากลับมาไม่สำเร็จ')
  return saved
}

export function draftFromProduct(product: ProductSummary, ownerUserId?: string): ProductDraft {
  return {
    localId: `remote:${product.id}`,
    ownerUserId,
    remoteProductId: product.id,
    sku: product.sku,
    category: product.category,
    subtype: product.subtype,
    brand: product.brand,
    model: product.model,
    serialNumber: product.serialNumber,
    title: product.title,
    price: product.price || undefined,
    cost: product.cost,
    conditionPercent: product.conditionPercent,
    warrantyUntil: product.warrantyUntil,
    defects: product.defects,
    notes: product.notes,
    specs: product.specs ?? {},
    status: product.status,
    originalStatus: product.status,
    images: product.images.map((image) => ({
      id: image.id,
      name: image.objectKey.split('/').pop() || 'image.jpg',
      previewUrl: image.publicUrl,
      isCover: image.isCover,
      order: image.sortOrder,
      remoteImageId: image.id,
      objectKey: image.objectKey,
      publicUrl: image.publicUrl,
      imageRole: image.imageRole,
    })),
    deletedRemoteImages: [],
    currentStep: 4,
    updatedAt: Date.now(),
  }
}

async function employeeApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!r2Api) throw new Error('ยังไม่ได้ตั้งค่า VITE_R2_UPLOAD_API')
  const session = await currentSession()
  const response = await fetch(`${r2Api}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const result = await response.json().catch(() => ({})) as any
  if (!response.ok) throw new Error(result?.error || `Employee API failed (${response.status})`)
  return result as T
}

export async function listEmployees(): Promise<EmployeeSummary[]> {
  const result = await employeeApi<{ employees: EmployeeSummary[] }>('/employees')
  return result.employees ?? []
}

export async function listEmployeeActivity(): Promise<EmployeeActivity[]> {
  const result = await employeeApi<{ activity: EmployeeActivity[] }>('/employees/activity')
  return result.activity ?? []
}

export async function createEmployee(input: { email: string; displayName: string; role: UserRole }): Promise<{ employee: EmployeeSummary; temporaryPassword: string }> {
  return await employeeApi('/employees', { method: 'POST', body: JSON.stringify(input) })
}

export async function updateEmployee(employeeId: string, patch: { displayName?: string; role?: UserRole; active?: boolean }): Promise<void> {
  await employeeApi(`/employees/${encodeURIComponent(employeeId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function resetEmployeePassword(employeeId: string): Promise<string> {
  const result = await employeeApi<{ temporaryPassword: string }>(`/employees/${encodeURIComponent(employeeId)}/reset-password`, { method: 'POST' })
  return result.temporaryPassword
}

async function currentSession(): Promise<Session> {
  const { data, error } = await client().auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  return data.session
}

async function uploadObject(productId: string, image: ProductImageDraft) {
  if (!r2Api) throw new Error('ยังไม่ได้ตั้งค่า VITE_R2_UPLOAD_API')
  if (!image.blob) throw new Error('ไม่พบไฟล์รูปในเครื่อง')
  const session = await currentSession()
  const response = await fetch(`${r2Api}/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'content-type': image.blob.type || 'image/jpeg',
      'x-product-id': productId,
      'x-filename': encodeURIComponent(image.name || 'image.jpg'),
    },
    body: image.blob,
  })
  const result = await response.json().catch(() => ({})) as { objectKey?: string; publicUrl?: string; error?: string }
  if (!response.ok || !result.objectKey) throw new Error(result.error || `R2 upload failed (${response.status})`)
  return { objectKey: result.objectKey, publicUrl: result.publicUrl }
}

async function deleteObject(productId: string, objectKey: string) {
  if (!r2Api) return
  const session = await currentSession()
  const response = await fetch(`${r2Api}/object`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${session.access_token}`,
      'x-product-id': productId,
      'x-object-key': objectKey,
    },
  })
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(result.error || `R2 delete failed (${response.status})`)
  }
}

export interface SaveProductHooks {
  onRemoteCreated?: (productId: string, sku: string) => Promise<void> | void
  onUploadStart?: (imageId: string) => void
  onUploadDone?: (imageId: string, remote: { remoteImageId: string; objectKey: string; publicUrl?: string }) => Promise<void> | void
  onUploadError?: (imageId: string, message: string) => void
}

export async function saveProduct(draft: ProductDraft, profile: Profile, hooks: SaveProductHooks = {}): Promise<ProductSummary> {
  if (!draft.category) throw new Error('กรุณาเลือกประเภทสินค้า')
  const db = client()
  const title = (draft.title || [draft.brand, draft.model].filter(Boolean).join(' ')).trim()
  if (!title) throw new Error('กรุณาระบุชื่อสินค้า')

  const desiredStatus = draft.status
  const newImages = draft.images.filter((image) => image.blob && !image.remoteImageId)
  if (['photo_ready', 'ready_to_list', 'published'].includes(desiredStatus) && draft.images.length === 0) {
    throw new Error('สถานะนี้ต้องมีรูปสินค้าอย่างน้อย 1 รูป')
  }
  if (['ready_to_list', 'published'].includes(desiredStatus)) validateReadyToList(draft)

  const duplicate = await findDuplicateIdentifier(draft.serialNumber, draft.remoteProductId)
  if (duplicate) {
    throw new Error(`Serial / IMEI นี้มีอยู่ในสต๊อกแล้ว: ${duplicate.sku} — ${duplicate.title}`)
  }

  let productId = draft.remoteProductId
  let sku = draft.sku || ''
  let existingStatus: ProductStatus | undefined
  let existingSerial = ''
  if (productId) {
    const { data: existing, error: existingError } = await db.from('products').select('status,serial_number').eq('id', productId).single()
    if (existingError) throw existingError
    existingStatus = existing.status as ProductStatus
    existingSerial = String(existing.serial_number ?? '')
    const allowed = allowedStatuses(existingStatus, profile.role)
    if (!allowed.includes(desiredStatus)) {
      throw new Error(`ไม่อนุญาตให้เปลี่ยนสถานะจาก ${existingStatus} เป็น ${desiredStatus}`)
    }
  }

  const statusDuringUpload: ProductStatus = productId
    ? (existingStatus ?? desiredStatus)
    : (newImages.length ? 'draft' : desiredStatus)

  const basePayload = {
    category: draft.category,
    subtype: draft.subtype || null,
    brand: draft.brand || null,
    model: draft.model || null,
    title,
    serial_number: draft.serialNumber?.trim() || null,
    status: statusDuringUpload,
    condition_percent: draft.conditionPercent ?? null,
    price: draft.price ?? null,
    warranty_until: draft.warrantyUntil || null,
    defects: draft.defects || null,
    notes: draft.notes || null,
    specs: draft.specs ?? {},
    updated_by: profile.id,
  }

  if (!productId) {
    const { data, error } = await db.from('products').insert({ ...basePayload, created_by: profile.id }).select('id,sku').single()
    if (error) throw error
    const createdProductId = String(data.id)
    productId = createdProductId
    sku = String(data.sku || '')
    await hooks.onRemoteCreated?.(createdProductId, sku)
    await logActivity(createdProductId, 'product_created', { category: draft.category, status: desiredStatus })
  } else {
    const { error } = await db.from('products').update(basePayload).eq('id', productId)
    if (error) throw error
    await logActivity(productId, 'product_updated', { title })
    if (normalizeIdentifier(existingSerial) !== normalizeIdentifier(draft.serialNumber)) {
      await logActivity(productId, 'identifier_changed', { from: existingSerial || null, to: draft.serialNumber || null })
    }
  }

  if (!productId) throw new Error('Supabase did not return a product id')
  const savedProductId = productId

  if (canSeeFinancials(profile.role)) {
    const { error } = await db.from('product_financials').upsert({
      product_id: savedProductId,
      cost: draft.cost ?? null,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
  }

  let deletedImageCount = 0
  for (const deleted of draft.deletedRemoteImages ?? []) {
    await deleteObject(savedProductId, deleted.objectKey)
    const { error } = await db.from('product_images').delete().eq('id', deleted.id).eq('product_id', savedProductId)
    if (error) throw error
    deletedImageCount += 1
  }
  if (deletedImageCount) await logActivity(savedProductId, 'images_deleted', { count: deletedImageCount })

  let uploadFailed = false
  let uploadedCount = 0
  for (const image of newImages) {
    hooks.onUploadStart?.(image.id)
    try {
      const uploaded = await uploadObject(savedProductId, image)
      const { data, error } = await db.from('product_images').insert({
        product_id: savedProductId,
        object_key: uploaded.objectKey,
        public_url: uploaded.publicUrl ?? null,
        sort_order: image.order,
        is_cover: image.isCover,
        image_role: image.imageRole || (image.isCover ? 'cover' : 'other'),
        bytes: image.blob?.size ?? null,
        created_by: profile.id,
      }).select('id').single()
      if (error) throw error
      uploadedCount += 1
      await hooks.onUploadDone?.(image.id, { remoteImageId: data.id, objectKey: uploaded.objectKey, publicUrl: uploaded.publicUrl })
    } catch (error) {
      uploadFailed = true
      const message = error instanceof Error ? error.message : String(error)
      hooks.onUploadError?.(image.id, message)
    }
  }
  if (uploadedCount) await logActivity(savedProductId, 'images_uploaded', { count: uploadedCount })

  const currentImages = [...draft.images].filter((image) => !(draft.deletedRemoteImages ?? []).some((deleted) => deleted.id === image.remoteImageId))
  const orderedRemote = currentImages.filter((image) => image.remoteImageId)
  for (let i = 0; i < orderedRemote.length; i++) {
    const image = orderedRemote[i]
    const { error } = await db.from('product_images').update({ sort_order: i, is_cover: image.isCover, image_role: image.imageRole || (image.isCover ? 'cover' : 'other') }).eq('id', image.remoteImageId!)
    if (error) throw error
  }

  if (uploadFailed) {
    await logActivity(savedProductId, 'image_upload_incomplete', { uploaded_count: uploadedCount, pending_count: newImages.length - uploadedCount })
    if (!draft.remoteProductId) {
      const { error } = await db.from('products').update({ status: 'draft', updated_by: profile.id }).eq('id', savedProductId)
      if (error) throw error
    }
    throw new Error('บันทึกข้อมูลแล้ว แต่มีบางรูปอัปโหลดไม่สำเร็จ รูปที่สำเร็จถูกจำไว้แล้ว กด “ลองอัปโหลดอีกครั้ง” เพื่อส่งเฉพาะรูปที่ค้าง')
  }

  const { error: finalizeError } = await db.from('products').update({ status: desiredStatus, updated_by: profile.id }).eq('id', savedProductId)
  if (finalizeError) throw finalizeError
  if (existingStatus && existingStatus !== desiredStatus) {
    await logActivity(savedProductId, 'status_changed', { from: existingStatus, to: desiredStatus })
  }
  await logActivity(savedProductId, 'product_saved', { status: desiredStatus, image_count: draft.images.length })

  const products = await listProducts(profile.role)
  const saved = products.find((product) => product.id === savedProductId)
  if (!saved) throw new Error(`บันทึกสำเร็จ แต่โหลดสินค้า ${sku} กลับมาไม่สำเร็จ`)
  return saved
}

export async function deleteProduct(product: ProductSummary) {
  await logActivity(product.id, 'product_deleted', { sku: product.sku, title: product.title })
  for (const image of product.images) {
    try { await deleteObject(product.id, image.objectKey) } catch { /* best effort cleanup */ }
  }
  const { error } = await client().from('products').delete().eq('id', product.id)
  if (error) throw error
}

export async function logActivity(productId: string, action: string, metadata: Record<string, unknown>) {
  const session = await currentSession()
  const { error } = await client().from('activity_logs').insert({
    actor_id: session.user.id,
    product_id: productId,
    action,
    metadata,
  })
  if (error) console.warn('activity log failed', error.message)
}

export function subscribeInventory(onChange: () => void): RealtimeChannel | null {
  if (!supabase) return null
  return supabase
    .channel('inventory-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_images' }, onChange)
    .subscribe()
}

export async function removeRealtimeChannel(channel: RealtimeChannel) {
  if (!supabase) return
  await supabase.removeChannel(channel)
}

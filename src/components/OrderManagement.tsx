import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Banknote, Box, CheckCircle2, LoaderCircle, PackageCheck, RefreshCw, RotateCcw, Truck, XCircle } from 'lucide-react'
import { actOnCommerceOrder, listCommerceOrders } from '../lib/orders'
import type { CommerceOrder, CommerceOrderStatus, Profile } from '../types/product'

const filters: Array<{ value: CommerceOrderStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'AWAITING_PAYMENT', label: 'รอชำระ' },
  { value: 'PAYMENT_REVIEW', label: 'รอตรวจยอด' },
  { value: 'PROCESSING', label: 'กำลังแพ็ก' },
  { value: 'SHIPPED', label: 'จัดส่งแล้ว' },
  { value: 'COMPLETED', label: 'สำเร็จ' },
]

const orderLabel: Record<string, string> = {
  AWAITING_PAYMENT: 'รอชำระเงิน', PAYMENT_REVIEW: 'รอตรวจสอบยอด', PROCESSING: 'กำลังดำเนินการ',
  SHIPPED: 'จัดส่งแล้ว', COMPLETED: 'สำเร็จ', CANCELLED: 'ยกเลิก', EXPIRED: 'หมดเวลา', REFUNDED: 'คืนเงินแล้ว',
}
const paymentLabel: Record<string, string> = { UNPAID: 'ยังไม่ชำระ', REVIEW: 'รอตรวจยอด', PAID: 'ชำระแล้ว', REFUND_PENDING: 'กำลังคืนเงิน', REFUNDED: 'คืนเงินแล้ว' }
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(value)
const dateTime = (value?: string) => value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

export function OrderManagement({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const [orders, setOrders] = useState<CommerceOrder[]>([])
  const [filter, setFilter] = useState<CommerceOrderStatus | 'ALL'>('ALL')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState<Record<string, { carrier: string; number: string; url: string }>>({})
  const canRefund = ['owner', 'admin'].includes(profile.role)

  async function load(nextFilter = filter) {
    setLoading(true); setError(null)
    try { setOrders(await listCommerceOrders(nextFilter)) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void load(filter) }, [filter])

  async function act(order: CommerceOrder, action: Parameters<typeof actOnCommerceOrder>[1]) {
    if (busy) return
    const confirmText: Partial<Record<typeof action, string>> = {
      CONFIRM_PAYMENT: 'ยืนยันว่าได้รับเงินแล้วและตัด SKU เป็นขายแล้ว?',
      CANCEL: 'ยกเลิก Order และคืนสินค้ากลับสต๊อก?',
      MARK_SHIPPED: 'ยืนยันว่าจัดส่งสินค้าแล้ว?',
      COMPLETE: 'ยืนยันปิด Order นี้?',
      REFUND: 'ยืนยันคืนเงินและเปลี่ยนสินค้าเป็น Returned? สินค้าจะไม่กลับมาขายอัตโนมัติจนกว่าจะตรวจสภาพใหม่',
    }
    if (confirmText[action] && !window.confirm(confirmText[action]!)) return
    setBusy(order.id); setError(null); setMessage(null)
    try {
      const t = tracking[order.id]
      await actOnCommerceOrder(order.id, action, { trackingCarrier: t?.carrier, trackingNumber: t?.number, trackingUrl: t?.url })
      setMessage(`${order.orderNumber}: อัปเดตสถานะเรียบร้อย`)
      await load(filter)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(null) }
  }

  const counts = useMemo(() => ({
    review: orders.filter((o) => o.paymentStatus === 'REVIEW').length,
    active: orders.filter((o) => !['COMPLETED','CANCELLED','EXPIRED','REFUNDED'].includes(o.orderStatus)).length,
  }), [orders])

  return <section className="screen page-pad order-admin-screen">
    <header className="topbar"><div className="order-admin-title"><button className="icon-btn" onClick={onBack}><ArrowLeft/></button><div><p className="eyebrow">ONLINE ORDERS</p><h1>คำสั่งซื้อ</h1></div></div><button className="refresh-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''}/></button></header>
    <div className="stats-grid order-stats"><div className="stat green"><span>Order ที่ยังทำงาน</span><strong>{counts.active}</strong></div><div className="stat amber"><span>รอตรวจยอด</span><strong>{counts.review}</strong></div></div>
    <div className="chip-row order-filter-row">{filters.map((item) => <button key={item.value} className={filter === item.value ? 'filter-chip active' : 'filter-chip'} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    {error && <div className="publish-error">{error}</div>}
    {message && <div className="publish-message">{message}</div>}
    {loading ? <div className="publish-loading"><LoaderCircle className="spin"/><span>กำลังโหลด Orders</span></div> : <div className="order-admin-list">
      {orders.map((order) => {
        const t = tracking[order.id] || { carrier: order.trackingCarrier || '', number: order.trackingNumber || '', url: order.trackingUrl || '' }
        return <article className="order-admin-card" key={order.id}>
          <div className="order-admin-head"><div><strong>{order.orderNumber}</strong><small>{dateTime(order.createdAt)} · {order.customerName} · {order.customerPhone}</small></div><div className="order-admin-badges"><span>{orderLabel[order.orderStatus] || order.orderStatus}</span><span className={`payment-${order.paymentStatus.toLowerCase()}`}>{paymentLabel[order.paymentStatus] || order.paymentStatus}</span></div></div>
          <div className="order-admin-items">{order.items.map((item) => <div key={item.sku}><span><b>{item.sku}</b> {item.title}</span><strong>{money(Number(item.unitPrice || 0))}</strong></div>)}</div>
          <div className="order-admin-detail-grid">
            <div><span>ยอดรวม</span><strong>{money(order.total)}</strong></div><div><span>รับสินค้า</span><strong>{order.deliveryMethod === 'PICKUP' ? 'รับที่ร้าน' : 'จัดส่ง'}</strong></div><div><span>ชำระ</span><strong>{order.paymentProvider === 'STRIPE' ? 'Stripe' : order.paymentMethod === 'PAY_AT_STORE' ? 'ชำระที่ร้าน' : 'โอนเงิน'}</strong></div><div><span>จองถึง</span><strong>{dateTime(order.reservationExpiresAt)}</strong></div>
          </div>
          {order.deliveryMethod === 'SHIPPING' && <div className="order-address"><strong>ที่จัดส่ง</strong><span>{[order.addressLine, order.subdistrict, order.district, order.province, order.postalCode].filter(Boolean).join(' ')}</span></div>}
          {order.paymentReference && <div className="payment-reference"><Banknote size={17}/><span>อ้างอิงการโอน: <strong>{order.paymentReference}</strong></span></div>}
          {order.paymentStatus === 'PAID' && order.deliveryMethod === 'SHIPPING' && !['COMPLETED'].includes(order.orderStatus) && <div className="tracking-editor"><input placeholder="ขนส่ง เช่น Flash / KEX" value={t.carrier} onChange={(e) => setTracking((current) => ({ ...current, [order.id]: { ...t, carrier: e.target.value } }))}/><input placeholder="Tracking number" value={t.number} onChange={(e) => setTracking((current) => ({ ...current, [order.id]: { ...t, number: e.target.value } }))}/><input placeholder="Tracking URL (ถ้ามี)" value={t.url} onChange={(e) => setTracking((current) => ({ ...current, [order.id]: { ...t, url: e.target.value } }))}/></div>}
          {order.paymentProvider === 'STRIPE' && <div className="payment-reference"><Banknote size={17}/><span>Stripe: <strong>{order.providerPaymentStatus || order.paymentStatus}</strong>{order.refundStatus ? ` · Refund ${order.refundStatus}` : ''}</span></div>}
          {order.document && <div className="payment-reference"><PackageCheck size={17}/><span>เอกสาร: <strong>{order.document.documentNumber}</strong></span></div>}
          {!!order.warranties?.length && <div className="payment-reference"><CheckCircle2 size={17}/><span>Warranty: <strong>{order.warranties.map((w) => w.warrantyNumber).join(', ')}</strong></span></div>}
          <div className="order-admin-actions">
            {order.paymentProvider !== 'STRIPE' && order.paymentStatus !== 'PAID' && ['AWAITING_PAYMENT','PAYMENT_REVIEW'].includes(order.orderStatus) && <button className="primary-button" onClick={() => void act(order,'CONFIRM_PAYMENT')} disabled={busy === order.id}><CheckCircle2/>ยืนยันรับเงิน</button>}
            {order.paymentStatus === 'PAID' && order.deliveryMethod === 'SHIPPING' && order.fulfillmentStatus === 'PACKING' && <button onClick={() => void act(order,'MARK_SHIPPED')} disabled={busy === order.id}><Truck/>ส่งออกจากร้าน</button>}
            {order.paymentStatus === 'PAID' && order.deliveryMethod === 'SHIPPING' && order.fulfillmentStatus === 'SHIPPED' && <button onClick={() => void act(order,'MARK_IN_TRANSIT')} disabled={busy === order.id}><Truck/>กำลังขนส่ง</button>}
            {order.paymentStatus === 'PAID' && order.deliveryMethod === 'SHIPPING' && ['SHIPPED','IN_TRANSIT'].includes(order.fulfillmentStatus) && <button onClick={() => void act(order,'MARK_DELIVERED')} disabled={busy === order.id}><PackageCheck/>ยืนยันส่งถึง</button>}
            {order.paymentStatus === 'PAID' && order.deliveryMethod === 'PICKUP' && order.fulfillmentStatus !== 'PICKUP_READY' && order.orderStatus !== 'COMPLETED' && <button onClick={() => void act(order,'MARK_PICKUP_READY')} disabled={busy === order.id}><Box/>พร้อมรับที่ร้าน</button>}
            {order.paymentStatus === 'PAID' && ((order.deliveryMethod === 'SHIPPING' && order.fulfillmentStatus === 'DELIVERED') || (order.deliveryMethod === 'PICKUP' && order.fulfillmentStatus === 'PICKUP_READY')) && <button onClick={() => void act(order,'COMPLETE')} disabled={busy === order.id}><PackageCheck/>ปิด Order</button>}
            {order.paymentStatus !== 'PAID' && !['CANCELLED','EXPIRED'].includes(order.orderStatus) && <button className="danger-soft" onClick={() => void act(order,'CANCEL')} disabled={busy === order.id}><XCircle/>ยกเลิก</button>}
            {canRefund && order.paymentStatus === 'PAID' && <button className="danger-soft" onClick={() => void act(order,'REFUND')} disabled={busy === order.id}><RotateCcw/>Refund</button>}
          </div>
        </article>
      })}
      {!orders.length && <div className="publish-empty"><PackageCheck/><strong>ยังไม่มี Order ในสถานะนี้</strong><span>เมื่อมีลูกค้าสั่งซื้อจาก shop.amphon.co.th จะแสดงที่นี่</span></div>}
    </div>}
  </section>
}

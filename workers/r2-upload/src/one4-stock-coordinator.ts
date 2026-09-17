import {
  confirmOne4SystemSale,
  one4SystemStockEnabled,
  releaseOne4SystemStock,
  type One4SystemStockEnv,
} from './one4-system-stock'

export interface One4CoordinatorEnv extends One4SystemStockEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

type One4Task = {
  id: string
  order_id: string
  action: 'CONFIRM_SOLD' | 'RELEASE'
  task_key: string
  payload: Record<string, any>
  attempts: number
}

type One4OrderState = {
  id: string
  one_stock_authority: boolean
  one_stock_state: string
  one_stock_last_error?: string | null
}

function serviceHeaders(env: One4CoordinatorEnv) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

async function serviceRequest<T>(env: One4CoordinatorEnv, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(env), ...(init.headers || {}) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`ONE4_COORDINATOR_DB_${response.status}:${text.slice(0, 280)}`)
  return (text ? JSON.parse(text) : null) as T
}

export async function loadOne4OrderState(env: One4CoordinatorEnv, orderId: string): Promise<One4OrderState | null> {
  const rows = await serviceRequest<One4OrderState[]>(
    env,
    `commerce_orders?id=eq.${encodeURIComponent(orderId)}&select=id,one_stock_authority,one_stock_state,one_stock_last_error&limit=1`,
  )
  return rows[0] || null
}

async function claimTasks(env: One4CoordinatorEnv, maxTasks: number, orderId?: string | null): Promise<One4Task[]> {
  const rows = await serviceRequest<One4Task[] | One4Task>(env, 'rpc/one4_claim_stock_tasks', {
    method: 'POST',
    body: JSON.stringify({ max_tasks: Math.min(Math.max(maxTasks, 1), 100), target_order_id: orderId || null }),
  })
  return Array.isArray(rows) ? rows : rows ? [rows] : []
}

async function completeTask(
  env: One4CoordinatorEnv,
  taskId: string,
  succeeded: boolean,
  result: unknown,
  errorCode: string | null,
  retryable: boolean,
) {
  return serviceRequest<any>(env, 'rpc/one4_complete_stock_task', {
    method: 'POST',
    body: JSON.stringify({
      task_id: taskId,
      succeeded,
      task_result: result || {},
      error_code: errorCode,
      retryable,
    }),
  })
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function skusFrom(payload: Record<string, any>) {
  return Array.isArray(payload.skus) ? payload.skus.map((value: unknown) => text(value).toUpperCase()).filter(Boolean) : []
}

function saleItemsFrom(payload: Record<string, any>) {
  return Array.isArray(payload.saleItems)
    ? payload.saleItems.map((item: any) => ({ sku: text(item?.sku).toUpperCase(), unitPrice: Number(item?.unitPrice) }))
    : []
}

async function executeTask(env: One4CoordinatorEnv, task: One4Task) {
  if (!one4SystemStockEnabled(env)) {
    await completeTask(env, task.id, false, {}, 'ONE4_SYSTEM_STOCK_DISABLED', true)
    return { taskId: task.id, action: task.action, status: 'RETRY', errorCode: 'ONE4_SYSTEM_STOCK_DISABLED' }
  }

  try {
    let result: any
    if (task.action === 'CONFIRM_SOLD') {
      result = await confirmOne4SystemSale(env, {
        checkoutIdempotencyKey: text(task.payload.checkoutIdempotencyKey),
        orderId: text(task.payload.orderId || task.order_id),
        skus: skusFrom(task.payload),
        saleItems: saleItemsFrom(task.payload),
        paymentProvider: text(task.payload.paymentProvider || 'MANUAL'),
        paymentReference: text(task.payload.paymentReference) || null,
        paidAt: text(task.payload.paidAt),
      })
      if (result?.ok && result?.outcome === 'SOLD') {
        await completeTask(env, task.id, true, result, null, false)
        return { taskId: task.id, action: task.action, status: 'SUCCEEDED', result }
      }
    } else {
      result = await releaseOne4SystemStock(env, {
        checkoutIdempotencyKey: text(task.payload.checkoutIdempotencyKey),
        skus: skusFrom(task.payload),
        reason: text(task.payload.reason || 'SHOP_ORDER_RELEASE'),
      })
      if (result?.ok && result?.outcome === 'RELEASED') {
        await completeTask(env, task.id, true, result, null, false)
        return { taskId: task.id, action: task.action, status: 'SUCCEEDED', result }
      }
    }

    const errorCode = text(result?.errorCode || `ONE4_SYSTEM_${result?.outcome || 'UNKNOWN'}`)
    const retryable = !['CONFLICT', 'REJECTED'].includes(String(result?.outcome || '').toUpperCase())
    await completeTask(env, task.id, false, result || {}, errorCode, retryable)
    return { taskId: task.id, action: task.action, status: retryable ? 'RETRY' : 'CONFLICT', errorCode, result }
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 280) : 'ONE4_SYSTEM_UNKNOWN'
    await completeTask(env, task.id, false, {}, errorCode, true).catch(() => undefined)
    return { taskId: task.id, action: task.action, status: 'RETRY', errorCode }
  }
}

export async function drainOne4StockTasks(
  env: One4CoordinatorEnv,
  options: { maxTasks?: number; orderId?: string | null } = {},
) {
  const tasks = await claimTasks(env, options.maxTasks || 25, options.orderId || null)
  const results = []
  for (const task of tasks) results.push(await executeTask(env, task))
  return { claimed: tasks.length, results }
}

/**
 * Payment webhook safety barrier. Stripe receives 2xx only after a ONE-managed paid order
 * is durably SOLD in System (or was already SOLD idempotently). A transient/unknown state
 * leaves the task durable and throws so Stripe retries the webhook without charging again.
 */
export async function ensureOne4SaleConfirmed(env: One4CoordinatorEnv, orderId: string) {
  const before = await loadOne4OrderState(env, orderId)
  if (!before?.one_stock_authority) return { oneStockAuthority: false, state: before?.one_stock_state || 'NONE' }
  if (before.one_stock_state === 'SOLD') return { oneStockAuthority: true, state: 'SOLD', duplicate: true }
  await drainOne4StockTasks(env, { orderId, maxTasks: 10 })
  const after = await loadOne4OrderState(env, orderId)
  if (after?.one_stock_state !== 'SOLD') {
    throw new Error(`ONE4_SALE_CONFIRM_NOT_SAFE:${after?.one_stock_state || 'UNKNOWN'}:${after?.one_stock_last_error || ''}`)
  }
  return { oneStockAuthority: true, state: 'SOLD', duplicate: false }
}

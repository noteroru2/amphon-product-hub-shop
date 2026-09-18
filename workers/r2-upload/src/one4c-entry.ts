import baseWorker from './index'
import {
  confirmOne4SystemSale,
  one4SystemStockEnabled,
  releaseOne4SystemStock,
  type One4SystemStockEnv,
  type One4SystemStockResult,
} from './one4-system-stock'

interface Env extends One4SystemStockEnv {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

type One4QueuedCommand = {
  id: string
  orderId: string
  action: 'CONFIRM_SOLD' | 'RELEASE'
  commandKey: string
  payload: Record<string, unknown>
  attempts: number
}

function serviceHeaders(env: Env) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    accept: 'application/json',
    'content-type': 'application/json',
  }
}

async function rpc<T>(env: Env, name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${name.toUpperCase()}:${response.status}:${text.slice(0, 500)}`)
  return (text ? JSON.parse(text) : null) as T
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) throw new Error('ONE4_COMMAND_SKUS_INVALID')
  const result = value.map((item) => String(item || '').trim()).filter(Boolean)
  if (!result.length) throw new Error('ONE4_COMMAND_SKUS_INVALID')
  return result
}

function saleItems(value: unknown) {
  if (!Array.isArray(value)) throw new Error('ONE4_COMMAND_SALE_ITEMS_INVALID')
  const result = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('ONE4_COMMAND_SALE_ITEMS_INVALID')
    const row = item as Record<string, unknown>
    const sku = String(row.sku || '').trim()
    const unitPrice = Number(row.unitPrice)
    if (!sku || !Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('ONE4_COMMAND_SALE_ITEMS_INVALID')
    return { sku, unitPrice }
  })
  if (!result.length) throw new Error('ONE4_COMMAND_SALE_ITEMS_INVALID')
  return result
}

function retryable(result: One4SystemStockResult) {
  if (result.outcome === 'CONFLICT' || result.outcome === 'REJECTED') return false
  const code = String(result.errorCode || '').toUpperCase()
  if (code.includes('HTTP_400') || code.includes('HTTP_401') || code.includes('HTTP_403') || code.includes('HTTP_409') || code.includes('HTTP_422')) return false
  return true
}

async function sendCommand(env: Env, command: One4QueuedCommand) {
  const payload = command.payload || {}
  if (command.action === 'CONFIRM_SOLD') {
    return confirmOne4SystemSale(env, {
      checkoutIdempotencyKey: String(payload.checkoutIdempotencyKey || ''),
      orderId: String(payload.orderId || command.orderId || ''),
      skus: stringArray(payload.skus),
      saleItems: saleItems(payload.saleItems),
      paymentProvider: String(payload.paymentProvider || 'MANUAL'),
      paymentReference: payload.paymentReference == null ? null : String(payload.paymentReference),
      paidAt: String(payload.paidAt || ''),
    })
  }
  if (command.action === 'RELEASE') {
    return releaseOne4SystemStock(env, {
      checkoutIdempotencyKey: String(payload.checkoutIdempotencyKey || ''),
      skus: stringArray(payload.skus),
      reason: String(payload.reason || 'SHOP_RELEASE_REQUESTED'),
    })
  }
  throw new Error('ONE4_COMMAND_ACTION_INVALID')
}

async function markFailed(env: Env, command: One4QueuedCommand, error: unknown, canRetry: boolean) {
  const message = error instanceof Error ? error.message : String(error)
  try {
    await rpc(env, 'one4_fail_shop_stock_command', {
      p_command_id: command.id,
      p_error: message.slice(0, 1000),
      p_retryable: canRetry,
    })
  } catch (markError) {
    console.error('ONE-4C failed to mark Shop stock command', { commandId: command.id, markError })
  }
}

async function drainOne4ShopCommands(env: Env) {
  if (!one4SystemStockEnabled(env)) return
  const claimed = await rpc<unknown>(env, 'one4_claim_shop_stock_commands', { max_commands: 10 })
  const commands = Array.isArray(claimed) ? claimed as One4QueuedCommand[] : []

  for (const command of commands) {
    try {
      const result = await sendCommand(env, command)
      const expected = command.action === 'CONFIRM_SOLD' ? 'SOLD' : 'RELEASED'
      if (!result.ok || result.outcome !== expected) {
        await markFailed(env, command, result.errorCode || `ONE4_SYSTEM_${result.outcome || 'UNKNOWN'}`, retryable(result))
        continue
      }
      await rpc(env, 'one4_complete_shop_stock_command', {
        p_command_id: command.id,
        p_system_result: result,
      })
    } catch (error) {
      const localContractError = String(error instanceof Error ? error.message : error).startsWith('ONE4_COMMAND_')
      await markFailed(env, command, error, !localContractError)
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return (baseWorker as any).fetch(request, env, ctx)
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (typeof (baseWorker as any).scheduled === 'function') {
      await (baseWorker as any).scheduled(controller, env, ctx)
    }

    const cron = controller.cron || ''
    if (!cron || cron === '*/5 * * * *') {
      try {
        await drainOne4ShopCommands(env)
      } catch (error) {
        console.error('ONE-4C Shop stock command drain failed', error)
      }
    }
  },
}

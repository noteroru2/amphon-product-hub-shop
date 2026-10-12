export interface RuntimeControlEnv {
  CONVERSATION_BATCHER?: DurableObjectNamespace
}

export function runtimeControl(env: RuntimeControlEnv) {
  if (!env.CONVERSATION_BATCHER) throw new Error('AI_RUNTIME_CONTROL_NOT_CONFIGURED')
  return env.CONVERSATION_BATCHER.get(env.CONVERSATION_BATCHER.idFromName('ai-buyer-runtime-control-v1'))
}

export function isQuotaExhausted(error: unknown) {
  return /credit_balance_exhausted|insufficient_quota|no credits remaining/i.test(String(error))
}

export async function guardedOpenAIFetch(env: RuntimeControlEnv, init: RequestInit) {
  const control = runtimeControl(env)
  const status = await control.fetch('https://control/circuit/status')
  if (!status.ok) throw new Error('AI_CIRCUIT_STATUS_UNAVAILABLE')
  const circuit = await status.json() as { blocked?: boolean }
  if (circuit.blocked) throw new Error('AI_CREDIT_CIRCUIT_OPEN')
  const response = await fetch('https://api.openai.com/v1/responses', {
    ...init, signal: AbortSignal.timeout(25000),
  })
  if (!response.ok && isQuotaExhausted(await response.clone().text())) {
    const trip = await control.fetch('https://control/circuit/trip', { method: 'POST' })
    if (!trip.ok) throw new Error('AI_CIRCUIT_TRIP_FAILED')
  }
  return response
}

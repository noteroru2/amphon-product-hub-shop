const CHUNK_RECOVERY_KEY = 'amphon-hub:chunk-recovery-attempt'
const RECOVERY_WINDOW_MS = 20_000

function messageOf(value: unknown) {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value ?? '') }
}

export function isRecoverableChunkError(value: unknown) {
  const message = messageOf(value).toLowerCase()
  return [
    'failed to fetch dynamically imported module',
    'error loading dynamically imported module',
    'importing a module script failed',
    'chunkloaderror',
    'loading chunk',
    'failed to fetch module script',
  ].some((needle) => message.includes(needle))
}

async function updateServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
  await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)))
}

async function recoverFromChunkFailure(reason: unknown) {
  if (!isRecoverableChunkError(reason)) return
  const previous = Number(sessionStorage.getItem(CHUNK_RECOVERY_KEY) || 0)
  if (Date.now() - previous < RECOVERY_WINDOW_MS) return

  sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(Date.now()))
  await updateServiceWorker()
  window.location.reload()
}

export function installRuntimeRecovery() {
  window.addEventListener('unhandledrejection', (event) => {
    void recoverFromChunkFailure(event.reason)
  })
  window.addEventListener('error', (event) => {
    void recoverFromChunkFailure(event.error || event.message)
  })

  // Once the new shell has stayed alive for a while, allow a future recovery.
  window.setTimeout(() => sessionStorage.removeItem(CHUNK_RECOVERY_KEY), RECOVERY_WINDOW_MS)
}

export async function hardReloadHub() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name !== 'product-images')
          .map((name) => caches.delete(name)),
      )
    }
  } finally {
    window.location.replace(`/?recovered=${Date.now()}`)
  }
}

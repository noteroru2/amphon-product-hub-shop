import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppCrashBoundary } from './components/AppCrashBoundary'
import { EnrichmentQueueDock } from './components/EnrichmentQueueDock'
import { PwaInstallPrompt } from './components/PwaInstallPrompt'
import { installRuntimeRecovery } from './lib/runtimeRecovery'
import './styles/app.css'
import './styles/publishCenterOverlay.css'
import './styles/hubEase.css'
import './styles/one2cEnrichment.css'

// Mobile browsers can treat capture="environment" as a camera-only request.
// App.tsx still uses capture on image inputs so taking a new photo remains a
// progressive hint, but before interaction we strip it from the live DOM so
// Android/iOS native pickers can offer Gallery/Photos, Camera, and Files.
function enableMobileImageLibraryPicker() {
  const imagePickerSelector =
    'input[type="file"][accept="image/*"][capture]'

  const normalizeImagePickers = () => {
    document
      .querySelectorAll<HTMLInputElement>(imagePickerSelector)
      .forEach((input) => input.removeAttribute('capture'))
  }

  const normalizeBeforePickerOpens = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    if (target.matches(imagePickerSelector)) {
      target.removeAttribute('capture')
      return
    }

    target
      .closest('label')
      ?.querySelectorAll<HTMLInputElement>(imagePickerSelector)
      .forEach((input) => input.removeAttribute('capture'))
  }

  normalizeImagePickers()

  const observer = new MutationObserver(normalizeImagePickers)
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Run in capture phase so the attribute is gone before the browser performs
  // the label/input default action and opens its native file picker.
  document.addEventListener('pointerdown', normalizeBeforePickerOpens, true)
  document.addEventListener('click', normalizeBeforePickerOpens, true)
}

installRuntimeRecovery()
enableMobileImageLibraryPicker()

const root = document.getElementById('root')
if (!root) throw new Error('AMPHON Hub root element is missing')

createRoot(root).render(
  <StrictMode>
    <AppCrashBoundary>
      <App />
      <EnrichmentQueueDock />
      <PwaInstallPrompt />
    </AppCrashBoundary>
  </StrictMode>,
)

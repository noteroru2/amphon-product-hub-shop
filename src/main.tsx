import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaInstallPrompt } from './components/PwaInstallPrompt'
import './styles/app.css'

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

enableMobileImageLibraryPicker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaInstallPrompt />
  </StrictMode>,
)

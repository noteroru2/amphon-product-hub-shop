import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { PwaInstallPrompt } from './components/PwaInstallPrompt'
import './styles/app.css'

// iOS/iPadOS treats capture="environment" as a camera-only request.
// Keep the existing upload workflow intact, but remove capture from the
// multi-image product picker so the native chooser can offer Photos,
// Camera, and Files instead of forcing the camera.
function enableMobileImageLibraryPicker() {
  const normalizeImagePicker = () => {
    document
      .querySelectorAll<HTMLInputElement>(
        'label.camera-button input[type="file"][accept="image/*"][multiple][capture]',
      )
      .forEach((input) => input.removeAttribute('capture'))
  }

  normalizeImagePicker()

  const observer = new MutationObserver(normalizeImagePicker)
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

enableMobileImageLibraryPicker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaInstallPrompt />
  </StrictMode>,
)

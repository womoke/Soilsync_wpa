import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        )
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith('soilsync-shell-'))
              .map((cacheName) => caches.delete(cacheName)),
          ),
        )
    },
    { once: true },
  )
} else if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Service worker registration is optional for the local demo shell.
      })
    },
    { once: true },
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

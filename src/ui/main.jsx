import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Strip the launch nonce from the address bar; the cookie now carries auth.
if (new URL(window.location.href).searchParams.has('n')) {
  window.history.replaceState({}, '', window.location.pathname)
}

// Apply the saved theme before first paint, or the default palette flashes.
try {
  const saved = window.localStorage.getItem('atlas.theme')
  document.documentElement.dataset.theme = saved || 'instrument-dark'
} catch {
  document.documentElement.dataset.theme = 'instrument-dark'
}

createRoot(document.getElementById('root')).render(<App />)

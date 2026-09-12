import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Strip the launch nonce from the address bar; the cookie now carries auth.
if (new URL(window.location.href).searchParams.has('n')) {
  window.history.replaceState({}, '', window.location.pathname)
}

createRoot(document.getElementById('root')).render(<App />)

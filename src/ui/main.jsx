import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Apply the saved theme before first paint, or the default palette flashes.
try {
  const saved = window.localStorage.getItem('claudesight.theme')
  document.documentElement.dataset.theme = saved || 'instrument-dark'
} catch {
  document.documentElement.dataset.theme = 'instrument-dark'
}

createRoot(document.getElementById('root')).render(<App />)

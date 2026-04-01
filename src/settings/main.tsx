import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles.css'
import { initializeThemeSync } from '../shared/theme'
import App from './App'

void initializeThemeSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

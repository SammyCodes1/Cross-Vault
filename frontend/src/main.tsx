import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/syne/600.css'
import '@fontsource/syne/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'
import App from './App.tsx'
import Landing from './Landing.tsx'

function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return path === '/app' ? <App /> : <Landing />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

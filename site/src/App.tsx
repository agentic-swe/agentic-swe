import { MotionConfig } from 'framer-motion'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LEGACY_MD_TO_SLUG } from './docs/registry'
import { PageShell } from './components/PageShell'
import { ScrollToTop } from './components/ScrollToTop'
import { CapabilitiesPage } from './pages/CapabilitiesPage'
import { DocPage } from './pages/DocPage'
import { DocumentationPage } from './pages/DocumentationPage'
import { GuidePage } from './pages/GuidePage'
import { HomePage } from './pages/HomePage'
import { ProductPage } from './pages/ProductPage'
import { SupportPage } from './pages/SupportPage'

/** Matches `base` in `vite.config.ts` (e.g. GitHub Pages subpath). Root deploy uses `undefined`. */
const routerBasename =
  (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || undefined

export default function App() {
  // Respect prefers-reduced-motion; with Reduce motion off in System Settings, motion runs at full strength.
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter basename={routerBasename}>
        <ScrollToTop />
        <Routes>
          {Object.entries(LEGACY_MD_TO_SLUG).map(([legacyPath, slug]) => (
            <Route
              key={legacyPath}
              path={legacyPath}
              element={<Navigate to={`/docs/${slug}`} replace />}
            />
          ))}
          <Route element={<PageShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/documentation" element={<DocumentationPage />} />
            <Route path="/docs/:slug" element={<DocPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/capabilities" element={<CapabilitiesPage />} />
            <Route path="/product" element={<ProductPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </MotionConfig>
  )
}

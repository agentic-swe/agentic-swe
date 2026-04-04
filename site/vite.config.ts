import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** GitHub project Pages: `https://<owner>.github.io/<repo>/` → set `VITE_BASE=/<repo>/` when building. */
function viteBase(): string {
  const raw = process.env.VITE_BASE?.trim()
  if (!raw || raw === '/') return '/'
  const withSlashes = raw.startsWith('/') ? raw : `/${raw}`
  return withSlashes.endsWith('/') ? withSlashes : `${withSlashes}/`
}

// Production bundle → site/dist/ (deploy this folder, not the whole site/ tree).
export default defineConfig({
  plugins: [react()],
  base: viteBase(),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

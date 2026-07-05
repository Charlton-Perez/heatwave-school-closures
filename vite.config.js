import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' so the built site works under a GitHub Pages project subpath
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 10000,
  },
})

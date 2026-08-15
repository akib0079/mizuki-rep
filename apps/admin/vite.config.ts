import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served by the API at /admin, so assets must resolve relative to that prefix.
  base: '/admin/',
  build: { outDir: 'dist', sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      // In development the console talks to the API on another port; cookies need
      // a same-origin path, so proxy rather than calling across origins.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // Country flags live with the API. In production the console is served from that same
      // origin, so this only exists to make development match what the studio will see.
      '/flags': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
})

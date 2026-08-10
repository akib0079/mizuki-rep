import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Built as one self-contained IIFE that the WordPress page loads from the API domain.
 *
 * A single file with CSS inlined keeps the embed to one script tag and avoids a second
 * cross-origin request for a stylesheet — and there is no module loading to go wrong inside
 * whichever theme the site is running.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    lib: {
      entry: 'src/embed.tsx',
      name: 'MizukiBooking',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
        // Inlined so the embed is a single script tag; the file stays small enough that
        // splitting the CSS out would cost more in round-trips than it saves.
        assetFileNames: 'widget.[ext]',
      },
    },
  },
  server: { port: 5174, proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } } },
})

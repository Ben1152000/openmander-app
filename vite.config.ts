import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      // Enable caching for static assets (PMTiles, CSV, etc.)
      'Cache-Control': 'public, max-age=31536000',
    },
  },
  optimizeDeps: {
    exclude: ['../wasm/pkg/openmander'],
  },
  build: {
    // Enable compression and chunking for better performance
    minify: 'esbuild',
    target: 'esnext',
    rollupOptions: {
      output: {
        // Split vendor chunks for better caching
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'pmtiles': ['pmtiles'],
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },
})

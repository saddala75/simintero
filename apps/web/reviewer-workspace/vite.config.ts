/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
  server: {
    port: 3055,
    proxy: {
      '/bff': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sim/design-system': path.resolve(__dirname, '../../packages/design-system/src/index.ts'),
      '@sim/reviewer-workspace': path.resolve(__dirname, '../../apps/web/reviewer-workspace/src'),
      '@sim/digicore-console': path.resolve(__dirname, '../../apps/web/digicore-console/src'),
      '@sim/quality-console': path.resolve(__dirname, '../../apps/web/quality-console/src'),
      '@sim/analytics-console': path.resolve(__dirname, '../../apps/web/analytics-console/src'),
      '@sim/ai-ops-console': path.resolve(__dirname, '../../apps/web/ai-ops-console/src'),
      '@sim/saas-admin': path.resolve(__dirname, '../../apps/web/saas-admin/src'),
      '@sim/support-console': path.resolve(__dirname, '../../apps/web/support-console/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/bff': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})

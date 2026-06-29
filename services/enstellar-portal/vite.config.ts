import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const web = (pkg: string, sub: string) =>
  path.resolve(__dirname, `../../apps/web/${pkg}/src/${sub}`)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // design-system barrel
      '@sim/design-system': path.resolve(__dirname, '../../packages/design-system/src/index.ts'),
      // reviewer-workspace
      '@sim/reviewer-workspace/pages/AiWorkbenchPage': web('reviewer-workspace', 'pages/AiWorkbenchPage.tsx'),
      // digicore-console
      '@sim/digicore-console/pages/PolicyListPage':      web('digicore-console', 'pages/PolicyListPage.tsx'),
      '@sim/digicore-console/pages/PolicyDetailPage':    web('digicore-console', 'pages/PolicyDetailPage.tsx'),
      '@sim/digicore-console/pages/GovernanceReportsPage': web('digicore-console', 'pages/GovernanceReportsPage.tsx'),
      // quality-console
      '@sim/quality-console/pages/GapAnalysisPage':      web('quality-console', 'pages/GapAnalysisPage.tsx'),
      '@sim/quality-console/pages/MeasurePerformancePage': web('quality-console', 'pages/MeasurePerformancePage.tsx'),
      '@sim/quality-console/pages/GapDetailPage':        web('quality-console', 'pages/GapDetailPage.tsx'),
      // single-App packages
      '@sim/analytics-console/App': web('analytics-console', 'App.tsx'),
      '@sim/ai-ops-console/App':    web('ai-ops-console',    'App.tsx'),
      '@sim/saas-admin/App':        web('saas-admin',        'App.tsx'),
      '@sim/support-console/App':   web('support-console',   'App.tsx'),
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
  optimizeDeps: {
    exclude: ['@sim/reviewer-workspace', '@sim/digicore-console', '@sim/quality-console',
              '@sim/analytics-console', '@sim/ai-ops-console', '@sim/saas-admin', '@sim/support-console'],
  },
})

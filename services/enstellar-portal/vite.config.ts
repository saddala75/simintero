import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const web = (pkg: string, sub: string) =>
  path.resolve(__dirname, `../../apps/web/${pkg}/src/${sub}`)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // tokens.css subpath alias must come before the barrel to prevent prefix collision
      '@sim/design-system/tokens.css': path.resolve(__dirname, '../../packages/design-system/src/tokens.css'),
      // design-system barrel
      '@sim/design-system': path.resolve(__dirname, '../../packages/design-system/src/index.ts'),
      // reviewer-workspace
      '@sim/reviewer-workspace/pages/AiWorkbenchPage': web('reviewer-workspace', 'pages/AiWorkbenchPage.tsx'),
      '@sim/reviewer-workspace/pages/CaseSelectorPage': web('reviewer-workspace', 'pages/CaseSelectorPage.tsx'),
      '@sim/reviewer-workspace/components/CitedDocumentPanel': web('reviewer-workspace', 'components/CitedDocumentPanel.tsx'),
      '@sim/reviewer-workspace/components/AiSummaryPanel':     web('reviewer-workspace', 'components/AiSummaryPanel.tsx'),
      // digicore-console
      '@sim/digicore-console/pages/PolicyListPage':      web('digicore-console', 'pages/PolicyListPage.tsx'),
      '@sim/digicore-console/pages/PolicyDetailPage':    web('digicore-console', 'pages/PolicyDetailPage.tsx'),
      '@sim/digicore-console/pages/NewPolicyPage':       web('digicore-console', 'pages/NewPolicyPage.tsx'),
      '@sim/digicore-console/pages/GovernanceReportsPage': web('digicore-console', 'pages/GovernanceReportsPage.tsx'),
      // quality-console
      '@sim/quality-console/pages/GapAnalysisPage':      web('quality-console', 'pages/GapAnalysisPage.tsx'),
      '@sim/quality-console/pages/MeasurePerformancePage': web('quality-console', 'pages/MeasurePerformancePage.tsx'),
      '@sim/quality-console/pages/GapDetailPage':        web('quality-console', 'pages/GapDetailPage.tsx'),
      '@sim/quality-console/pages/MeasureLibraryPage':   web('quality-console', 'pages/MeasureLibraryPage.tsx'),
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

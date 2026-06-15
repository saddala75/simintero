import { defineConfig } from '@playwright/test'

const useMockBff = !process.env.PLAYWRIGHT_REAL_STACK

export default defineConfig({
  testDir: './e2e',
  testIgnore: useMockBff ? '**/real-stack/**' : undefined,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: useMockBff
    ? [
        {
          command: 'npx tsx e2e/mock-bff.ts',
          url: 'http://localhost:8001/bff/queues/default/worklist',
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: 'npm run dev',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 30_000,
        },
      ]
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})

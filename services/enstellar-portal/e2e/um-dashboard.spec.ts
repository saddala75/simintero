import { test, expect } from '@playwright/test'

test('UM dashboard: gauge card shows SLA % from /stats endpoint', async ({ page }) => {
  await page.goto('/queues/default/worklist')
  await expect(page.locator('.en-gauge-card')).toBeVisible({ timeout: 10_000 })
  // mock /stats returns sla_compliance_expedited_pct: 96.0 → rendered as "96.0%"
  await expect(page.locator('.en-gauge-card .gv')).toContainText('96')
})

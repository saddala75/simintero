import { test, expect } from '@playwright/test'

test('authenticated app renders the AppShell with identity (mock auth)', async ({ page }) => {
  await page.goto('/queues/default/worklist')
  // ProtectedRoute let us through (mock auth) — the shared AppShell topbar is present.
  await expect(page.locator('.en-topbar .en-brand')).toContainText('Enstellar')
  await expect(page.locator('.en-env')).toContainText('TENANT · TENANT-DEV')
  await expect(page.locator('.en-avatar')).toBeVisible()
  // the worklist body still loads from the (mock) BFF
  await expect(page.locator('.en-queue').first()).toBeVisible()
})

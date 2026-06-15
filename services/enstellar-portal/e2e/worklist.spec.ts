/**
 * E2E golden path: load worklist → click first row → open case workspace → submit approval.
 *
 * Requires:
 *   - BFF running on http://localhost:8001 (or proxied via Vite at /bff)
 *   - Valid reviewer session (auth handled by test setup / mock BFF in CI)
 *
 * In CI the BFF is replaced by a lightweight mock server (see e2e/mock-bff.ts).
 * In local dev against the real stack, set PLAYWRIGHT_REAL_STACK=1.
 */
import { test, expect } from '@playwright/test'

test.describe('reviewer worklist → case workspace → submit approval', () => {
  test('load worklist, open first case, submit approval', async ({ page }) => {
    // 1. Land on the worklist page
    await page.goto('/queues/default/worklist')

    // 2. The worklist table must be visible
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 })

    // 3. At least one data row is present
    const firstRow = page.locator('tbody tr').first()
    await expect(firstRow).toBeVisible()

    // 4. Click the first row to navigate to the case workspace
    await firstRow.click()

    // 5. Case header, service lines panel, and events timeline must appear
    await expect(page.getByTestId('case-header')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('service-lines-panel')).toBeVisible()
    await expect(page.getByTestId('events-timeline')).toBeVisible()

    // 6. Submit approval
    await page.getByTestId('btn-approve').click()

    // 7. Confirmation must appear
    await expect(page.getByTestId('decision-confirmed')).toBeVisible({ timeout: 5_000 })
  })
})

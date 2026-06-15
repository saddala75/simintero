/**
 * E2E: adverse determination flow — clinician fills form, confirms sign-off, submits.
 * Also verifies the submit button stays disabled until all required fields are present.
 */
import { test, expect } from '@playwright/test'

test.describe('adverse determination flow', () => {
  async function openAdversePanel(page: ReturnType<typeof test.extend>) {
    await page.goto('/queues/default/worklist')
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 })
    await page.locator('tbody tr').first().click()
    await expect(page.getByTestId('case-header')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('btn-adverse').click()
    await expect(page.getByTestId('adverse-panel')).toBeVisible()
  }

  test('submit button disabled until all fields filled and checkbox checked', async ({ page }) => {
    await openAdversePanel(page)

    const submitBtn = page.getByTestId('btn-submit-adverse')
    await expect(submitBtn).toBeDisabled()

    // Fill reason only — still disabled
    await page.getByTestId('adverse-reason').fill('Medical necessity not met')
    await expect(submitBtn).toBeDisabled()

    // Add clinician ID — still disabled (no checkbox)
    await page.getByTestId('adverse-clinician-id').fill('NPI-12345')
    await expect(submitBtn).toBeDisabled()

    // Check confirmation — now enabled
    await page.getByTestId('adverse-confirm-checkbox').check()
    await expect(submitBtn).toBeEnabled()
  })

  test('cancel hides the adverse panel', async ({ page }) => {
    await openAdversePanel(page)
    await page.getByTestId('btn-cancel-adverse').click()
    await expect(page.getByTestId('adverse-panel')).not.toBeVisible()
  })

  test('successful adverse submission shows confirmation', async ({ page }) => {
    await openAdversePanel(page)

    await page.getByTestId('adverse-outcome').selectOption('denied')
    await page.getByTestId('adverse-reason').fill('Medical necessity not met per clinical guidelines')
    await page.getByTestId('adverse-clinician-id').fill('NPI-12345')
    await page.getByTestId('adverse-confirm-checkbox').check()

    await page.getByTestId('btn-submit-adverse').click()

    await expect(page.getByTestId('decision-confirmed')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('decision-confirmed')).toContainText('Denied')
  })

  test('adverse outcome selection propagates to confirmation label', async ({ page }) => {
    await openAdversePanel(page)

    await page.getByTestId('adverse-outcome').selectOption('partially_denied')
    await page.getByTestId('adverse-reason').fill('Partial approval based on evidence')
    await page.getByTestId('adverse-clinician-id').fill('NPI-99999')
    await page.getByTestId('adverse-confirm-checkbox').check()

    await page.getByTestId('btn-submit-adverse').click()

    await expect(page.getByTestId('decision-confirmed')).toContainText('Partially Denied')
  })
})

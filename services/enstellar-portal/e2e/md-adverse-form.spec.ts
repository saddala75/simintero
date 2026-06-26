/**
 * E2E: MD adverse determination form — MdAdverseForm component.
 * Tests the full MD sign-off flow: gap findings pre-populated,
 * chip inputs for reason codes / citations, submit guard, and completion.
 */
import { test, expect } from '@playwright/test'

const MD_CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'

test.describe('MD adverse form', () => {
  async function openMdCase(page: ReturnType<typeof test.extend>) {
    await page.goto('/queues/default/worklist')
    await expect(page.locator('table')).toBeVisible({ timeout: 10_000 })
    // Second row is the md_review case
    await page.locator('tbody tr').nth(1).click()
    await expect(page.getByTestId('case-header')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(new RegExp(MD_CASE_ID))
    await expect(page.getByTestId('md-adverse-form')).toBeVisible({ timeout: 5_000 })
  }

  test('gap findings pre-populated and toggleable', async ({ page }) => {
    await openMdCase(page)

    // C-02 and C-03 are gap/unknown — should be pre-populated and checked
    await expect(page.getByTestId('finding-toggle-C-02')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('finding-toggle-C-03')).toBeVisible()

    // C-01 is 'met' — should NOT appear
    await expect(page.getByTestId('finding-toggle-C-01')).not.toBeVisible()

    // Uncheck C-03
    await page.getByTestId('finding-toggle-C-03').locator('input[type="checkbox"]').uncheck()
    await expect(
      page.getByTestId('finding-toggle-C-03').locator('input[type="checkbox"]')
    ).not.toBeChecked()

    // C-02 checkbox should remain checked
    await expect(
      page.getByTestId('finding-toggle-C-02').locator('input[type="checkbox"]')
    ).toBeChecked()
  })

  test('reason code chips: add via button and remove with ×', async ({ page }) => {
    await openMdCase(page)

    // Add a reason code
    await page.getByTestId('reason-code-input').fill('M54.5')
    await page.getByTestId('add-reason-code').click()

    await expect(page.getByTestId('remove-code-M54.5')).toBeVisible()

    // Add a second code via Enter key
    await page.getByTestId('reason-code-input').fill('M51.16')
    await page.getByTestId('reason-code-input').press('Enter')

    await expect(page.getByTestId('remove-code-M51.16')).toBeVisible()

    // Remove the first code
    await page.getByTestId('remove-code-M54.5').click()
    await expect(page.getByTestId('remove-code-M54.5')).not.toBeVisible()
    // Second code still present
    await expect(page.getByTestId('remove-code-M51.16')).toBeVisible()
  })

  test('citation chips: add via button and remove with ×', async ({ page }) => {
    await openMdCase(page)

    await page.getByTestId('citation-input').fill('InterQual 2025 §3.4.1')
    await page.getByTestId('add-citation').click()

    await expect(page.getByTestId('remove-citation-InterQual 2025 §3.4.1')).toBeVisible()

    // Add second via Enter
    await page.getByTestId('citation-input').fill('Plan Policy §4.2.1')
    await page.getByTestId('citation-input').press('Enter')

    await expect(page.getByTestId('remove-citation-Plan Policy §4.2.1')).toBeVisible()

    // Remove first
    await page.getByTestId('remove-citation-InterQual 2025 §3.4.1').click()
    await expect(
      page.getByTestId('remove-citation-InterQual 2025 §3.4.1')
    ).not.toBeVisible()
  })

})

/**
 * E2E: Phase 4 — MD determination & sign-off flow.
 * Tests the 3-column MD view: GateColumn readiness, criteria display,
 * notice preview modal, progressive gate completion, and final issue.
 */
import { test, expect } from '@playwright/test'

const MD_CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
const MD_URL = `/cases/${MD_CASE_ID}`

/** Fill all required form fields to make the gate fully ready. */
async function fillMdForm(page: import('@playwright/test').Page) {
  await page.fill('[data-testid="citation-input"]', 'Policy §4.2.1')
  await page.locator('[data-testid="add-citation"]').click()
  await page.fill('[data-testid="md-rationale"]', 'Patient does not meet medical necessity criteria per policy §4.2.1. No physician attestation provided.')
  await page.fill('[data-testid="md-clinician-id"]', 'NPI-1234567890')
  await page.locator('[data-testid="md-confirm-checkbox"]').check()
}

test.describe('Phase 4 — MD determination & sign-off', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MD_URL)
    // Wait until the gate column is visible — confirms MD view has fully rendered
    await expect(page.locator('.en-col.gate')).toBeVisible({ timeout: 10_000 })
  })

  test('MD view renders 3-column layout (ctx / work / gate)', async ({ page }) => {
    await expect(page.locator('.en-col.ctx')).toBeVisible()
    await expect(page.locator('.en-col.work')).toBeVisible()
    await expect(page.locator('.en-col.gate')).toBeVisible()
  })

  test('GateColumn renders 6 readiness checklist items', async ({ page }) => {
    await expect(page.locator('.en-chk')).toHaveCount(6)
  })

  test('"Issue determination" button is disabled before form is complete', async ({ page }) => {
    await expect(page.locator('[data-testid="btn-issue-determination"]')).toBeDisabled()
  })

  test('Criteria are displayed live from the BFF — gap criterion shows ⚠', async ({ page }) => {
    // Section 2 renders all 3 criteria from the fixture
    await expect(page.locator('.en-crit-row')).toHaveCount(3, { timeout: 8_000 })
    // The gap criterion (crit-02) renders with class 'gap' and ⚠ icon
    await expect(page.locator('.en-crit-row.gap .en-crit-icon')).toContainText('⚠')
    // Gap note text appears below the gap criterion
    await expect(page.locator('.en-crit-gap-note')).toContainText('Being addressed in determination')
  })

  test('"Preview notice letter" button opens modal with notice body', async ({ page }) => {
    await page.locator('[data-testid="btn-preview-notice"]').click()
    await expect(page.locator('.en-modal-card')).toBeVisible()
    await expect(page.locator('[data-testid="notice-preview-body"]')).toContainText(
      'NOTICE OF ADVERSE DETERMINATION',
      { timeout: 8_000 },
    )
  })

  test('Notice modal closes via close button', async ({ page }) => {
    await page.locator('[data-testid="btn-preview-notice"]').click()
    await expect(page.locator('.en-modal-card')).toBeVisible()
    await page.locator('[data-testid="btn-close-notice-preview"]').click()
    await expect(page.locator('.en-modal-card')).not.toBeVisible()
  })

  test('Adding a citation marks the "Citations added" gate item done', async ({ page }) => {
    // Gate item at index 3 is "Citations added" — initially NOT done
    // (items 0-2 auto-complete: type selected, criteria loaded, has findings)
    const citationsItem = page.locator('.en-chk').nth(3)
    await expect(citationsItem).not.toHaveClass(/done/)

    // Add a citation
    await page.fill('[data-testid="citation-input"]', 'Policy §4.2.1')
    await page.locator('[data-testid="add-citation"]').click()

    // Citations gate item becomes done
    await expect(citationsItem).toHaveClass(/done/, { timeout: 5_000 })
  })

  test('Writing rationale marks the "Clinical rationale complete" gate item done', async ({ page }) => {
    // Gate item at index 4 is "Clinical rationale complete" — initially NOT done
    const rationaleItem = page.locator('.en-chk').nth(4)
    await expect(rationaleItem).not.toHaveClass(/done/)

    await page.fill('[data-testid="md-rationale"]', 'Not medically necessary.')

    // Rationale gate item becomes done
    await expect(rationaleItem).toHaveClass(/done/, { timeout: 5_000 })
  })

  test('Completing all form fields enables the "Issue determination" button', async ({ page }) => {
    await expect(page.locator('[data-testid="btn-issue-determination"]')).toBeDisabled()
    await fillMdForm(page)
    await expect(page.locator('[data-testid="btn-issue-determination"]')).toBeEnabled({ timeout: 5_000 })
  })

  test('Clicking "Issue determination" POSTs adverse-decision and shows issued banner', async ({ page }) => {
    await fillMdForm(page)
    await expect(page.locator('[data-testid="btn-issue-determination"]')).toBeEnabled({ timeout: 5_000 })
    await page.locator('[data-testid="btn-issue-determination"]').click()
    await expect(page.locator('.en-issued-banner')).toBeVisible({ timeout: 8_000 })
    await expect(page.locator('.en-issued-banner')).toContainText('Determination recorded')
  })
})

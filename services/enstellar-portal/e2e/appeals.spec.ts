import { test, expect, type Page } from '@playwright/test'

const CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const MD_CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
const APPEAL_ID = 'appeal-aaaa-bbbb-cccc-000000000001'
const APPEAL_URL = `/cases/${CASE_ID}/appeals/${APPEAL_ID}`
const MD_CASE_URL = `/cases/${MD_CASE_ID}`

/** Fill and submit the MD adverse determination form to get decisionDone=true. */
async function completeMdDetermination(page: Page) {
  await page.goto(MD_CASE_URL)
  await page.waitForSelector('[data-testid="md-adverse-form"]')
  // Criteria must load before rationale is entered
  await page.fill('[data-testid="md-rationale"]', 'Clinically not indicated per policy 4.2.1')
  await page.fill('[data-testid="citation-input"]', 'Policy §4.2.1')
  await page.locator('[data-testid="add-citation"]').click()
  await page.fill('[data-testid="md-clinician-id"]', 'NPI-123456')
  await page.locator('[data-testid="md-confirm-checkbox"]').check()
  await page.locator('[data-testid="btn-issue-determination"]').click()
  await page.waitForSelector('.en-issued-banner')
}

/** Fill all fields of the AppealDecisionForm. */
async function fillAppealDecisionForm(page: Page) {
  await page.locator('[data-testid="appeal-outcome-uphold"]').check()
  await page.fill('[data-testid="appeal-citation-input"]', 'Policy §4.2.1 — attestation criteria')
  await page.locator('[data-testid="appeal-add-citation"]').click()
  await page.fill('[data-testid="appeal-rationale"]', 'Treating physician attestation was received and reviewed. Medical necessity is not supported.')
  await page.fill('[data-testid="appeal-clinician-id"]', 'NPI-1234567890')
  await page.locator('[data-testid="appeal-confirm-checkbox"]').check()
}

test('1. /appeals renders "Assigned to me" tab by default with one row', async ({ page }) => {
  await page.goto('/appeals')
  await expect(page.locator('.en-tab.active')).toContainText('Assigned to me')
  await expect(page.locator(`[data-testid="appeal-row-${APPEAL_ID}"]`)).toBeVisible()
})

test('2. "All open" tab shows two appeal rows', async ({ page }) => {
  await page.goto('/appeals?tab=open')
  await expect(page.locator('[data-testid^="appeal-row-"]')).toHaveCount(2)
})

test('3. "File appeal" button on AppealsPage opens filing modal', async ({ page }) => {
  await page.goto('/appeals')
  await page.locator('[data-testid="btn-file-appeal-worklist"]').click()
  await expect(page.locator('[data-testid="appeal-case-id-input"]')).toBeVisible()
})

test('4. Filing modal submit is disabled until all required fields are filled', async ({ page }) => {
  await page.goto('/appeals')
  await page.locator('[data-testid="btn-file-appeal-worklist"]').click()
  await expect(page.locator('[data-testid="btn-submit-appeal-filing"]')).toBeDisabled()
  await page.fill('[data-testid="appeal-case-id-input"]', CASE_ID)
  await page.selectOption('[data-testid="appeal-category-select"]', 'member_request')
  await page.fill('[data-testid="appeal-grounds-input"]', 'New clinical evidence was not reviewed.')
  await expect(page.locator('[data-testid="btn-submit-appeal-filing"]')).toBeDisabled()
  await page.selectOption('[data-testid="appeal-outcome-select"]', 'full_overturn')
  await expect(page.locator('[data-testid="btn-submit-appeal-filing"]')).toBeEnabled()
})

test('5. Successful filing navigates to /cases/:id/appeals/:id', async ({ page }) => {
  await page.goto('/appeals')
  await page.locator('[data-testid="btn-file-appeal-worklist"]').click()
  await page.fill('[data-testid="appeal-case-id-input"]', CASE_ID)
  await page.selectOption('[data-testid="appeal-category-select"]', 'member_request')
  await page.fill('[data-testid="appeal-grounds-input"]', 'New clinical evidence was not reviewed.')
  await page.selectOption('[data-testid="appeal-outcome-select"]', 'full_overturn')
  await page.locator('[data-testid="btn-submit-appeal-filing"]').click()
  await expect(page).toHaveURL(APPEAL_URL)
})

test('6. CasePage issued banner shows "File appeal" button after adverse determination', async ({ page }) => {
  await completeMdDetermination(page)
  await expect(page.locator('[data-testid="btn-file-appeal-from-case"]')).toBeVisible()
})

test('7. Filing modal opened from CasePage has case ID pre-filled and read-only', async ({ page }) => {
  await completeMdDetermination(page)
  await page.locator('[data-testid="btn-file-appeal-from-case"]').click()
  const input = page.locator('[data-testid="appeal-case-id-input"]')
  await expect(input).toHaveValue(MD_CASE_ID)
  await expect(input).toHaveAttribute('readonly', '')
})

test('8. Appeal detail page renders 3-column layout', async ({ page }) => {
  await page.goto(APPEAL_URL)
  await expect(page.locator('.en-col.ctx')).toBeVisible()
  await expect(page.locator('.en-col.work')).toBeVisible()
  await expect(page.locator('.en-col.gate')).toBeVisible()
})

test('9. btn-issue-appeal-decision is disabled until all form fields are filled', async ({ page }) => {
  await page.goto(APPEAL_URL)
  await expect(page.locator('[data-testid="btn-issue-appeal-decision"]')).toBeDisabled()
  await fillAppealDecisionForm(page)
  await expect(page.locator('[data-testid="btn-issue-appeal-decision"]')).toBeEnabled()
})

test('10. Submitting appeal decision with sign_off_confirmed shows issued banner', async ({ page }) => {
  await page.goto(APPEAL_URL)
  await fillAppealDecisionForm(page)
  await page.locator('[data-testid="btn-issue-appeal-decision"]').click()
  await expect(page.locator('.en-issued-banner')).toContainText('Appeal decision recorded')
})

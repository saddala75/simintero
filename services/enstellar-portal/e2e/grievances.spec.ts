import { test, expect, type Page } from '@playwright/test'
import { setupMockBff, CASE_ID, APPEAL_ID, GRIEVANCE_ID } from './mock-bff'

// Suppress unused import warning — APPEAL_ID and CASE_ID are exported from
// mock-bff for completeness but not used directly in assertions here.
void APPEAL_ID
void CASE_ID

const MD_CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000002'
const GRIEVANCES_URL = 'http://localhost:5173/grievances'
const GRIEVANCE_URL = `http://localhost:5173/grievances/${GRIEVANCE_ID}`
const MD_CASE_URL = `/cases/${MD_CASE_ID}`

/** Navigate to an MD-review case, fill and submit the adverse form, wait for the issued banner. */
async function completeMdDetermination(page: Page) {
  await page.goto(MD_CASE_URL)
  await page.waitForSelector('[data-testid="md-adverse-form"]')
  await page.fill('[data-testid="md-rationale"]', 'Clinically not indicated per policy 4.2.1')
  await page.fill('[data-testid="citation-input"]', 'Policy §4.2.1')
  await page.locator('[data-testid="add-citation"]').click()
  await page.fill('[data-testid="md-clinician-id"]', 'NPI-123456')
  await page.locator('[data-testid="md-confirm-checkbox"]').check()
  await page.locator('[data-testid="btn-issue-determination"]').click()
  await page.waitForSelector('.en-issued-banner')
}

/** Fill the resolution textarea so the Resolve button becomes enabled. */
async function fillGrievanceResolutionForm(page: Page) {
  await page.fill('[data-testid="grievance-resolution-textarea"]', 'Reviewed and resolved in favor of member')
}

test.describe('Phase 5B — Grievances portal', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockBff(page)
  })

  test('1 — GrievancesPage shows assigned tab and grievance row', async ({ page }) => {
    await page.goto(GRIEVANCES_URL)
    await expect(page.locator('.en-tab.active')).toContainText('Assigned to me')
    await expect(page.locator(`[data-testid="grievance-row-${GRIEVANCE_ID}"]`)).toBeVisible()
  })

  test('2 — btn-file-grievance-worklist opens GrievanceFilingModal', async ({ page }) => {
    await page.goto(GRIEVANCES_URL)
    await page.click('[data-testid="btn-file-grievance-worklist"]')
    await expect(page.locator('[data-testid="grievance-member-ref-input"]')).toBeVisible()
  })

  test('3 — Filing modal submit disabled until member_ref filled', async ({ page }) => {
    await page.goto(GRIEVANCES_URL)
    await page.click('[data-testid="btn-file-grievance-worklist"]')
    await expect(page.locator('[data-testid="btn-submit-grievance-filing"]')).toBeDisabled()
    await page.fill('[data-testid="grievance-member-ref-input"]', 'member-001')
    await expect(page.locator('[data-testid="btn-submit-grievance-filing"]')).toBeEnabled()
  })

  test('4 — Successful filing navigates to grievance detail', async ({ page }) => {
    await page.goto(GRIEVANCES_URL)
    await page.click('[data-testid="btn-file-grievance-worklist"]')
    await page.fill('[data-testid="grievance-member-ref-input"]', 'member-001')
    await page.click('[data-testid="btn-submit-grievance-filing"]')
    await expect(page).toHaveURL(GRIEVANCE_URL)
  })

  test('5 — CasePage issued banner shows btn-file-grievance-from-case', async ({ page }) => {
    await completeMdDetermination(page)
    await expect(page.locator('[data-testid="btn-file-grievance-from-case"]')).toBeVisible()
  })

  test('6 — btn-file-grievance-from-case opens modal with case_id pre-filled', async ({ page }) => {
    await completeMdDetermination(page)
    await page.click('[data-testid="btn-file-grievance-from-case"]')
    await expect(page.locator('[data-testid="grievance-case-id-input"]')).toHaveValue(MD_CASE_ID)
    await expect(page.locator('[data-testid="grievance-case-id-input"]')).toHaveAttribute('readonly', '')
  })

  test('7 — GrievanceDetailPage renders 3-column layout', async ({ page }) => {
    await page.goto(GRIEVANCE_URL)
    await expect(page.locator('.en-col.ctx')).toBeVisible()
    await expect(page.locator('.en-col.work')).toBeVisible()
    await expect(page.locator('.en-col.gate')).toBeVisible()
  })

  test('8 — btn-acknowledge-grievance visible when status filed (coordinator)', async ({ page }) => {
    // Override the detail GET to return status='filed' (overrides setupMockBff handler — LIFO)
    await page.route('**/bff/grievances/**', async (route) => {
      const url = new URL(route.request().url()).pathname
      if (route.request().method() === 'GET' && !url.endsWith('/assigned')) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            grievance_id: GRIEVANCE_ID,
            member_ref: 'member-001',
            case_id: null,
            category: 'billing',
            description: 'Incorrect charge',
            urgency: 'standard',
            lob: 'ma',
            status: 'filed',
            filed_by: 'user-001',
            filed_at: '2026-06-26T10:00:00Z',
            acknowledged_at: null,
            acknowledged_by: null,
            assigned_to: null,
            assigned_at: null,
            resolution: null,
            resolved_at: null,
            resolution_due_at: '2026-07-16T10:00:00Z',
          }),
        })
      } else {
        route.fallback()
      }
    })
    await page.goto(GRIEVANCE_URL)
    await expect(page.locator('[data-testid="btn-acknowledge-grievance"]')).toBeVisible()
    await page.click('[data-testid="btn-acknowledge-grievance"]')
    // Mutation fired — no assertion error expected; button may or may not disappear
    // depending on refetch timing. We simply confirm no error was thrown.
  })

  test('9 — btn-resolve-grievance disabled until resolution written', async ({ page }) => {
    await page.goto(GRIEVANCE_URL)
    await expect(page.locator('[data-testid="btn-resolve-grievance"]')).toBeDisabled()
    await page.fill('[data-testid="grievance-resolution-textarea"]', 'Resolved in favor of member')
    await expect(page.locator('[data-testid="btn-resolve-grievance"]')).toBeEnabled()
  })

  test('10 — Resolution submit shows resolved banner', async ({ page }) => {
    await page.goto(GRIEVANCE_URL)
    await fillGrievanceResolutionForm(page)
    await page.click('[data-testid="btn-resolve-grievance"]')
    await expect(page.locator('.en-resolved-banner')).toContainText('Grievance resolved')
  })
})

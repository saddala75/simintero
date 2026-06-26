import { test, expect } from '@playwright/test'

const CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
const CASE_URL = `/cases/${CASE_ID}`

test.describe('Phase 3 — Clinical review / nurse screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CASE_URL)
    await expect(page.locator('[data-testid="case-header"]')).toBeVisible({ timeout: 10_000 })
  })

  test('AppShell topbar renders on the case page', async ({ page }) => {
    await expect(page.locator('.en-topbar .en-brand')).toContainText('Enstellar')
    await expect(page.locator('.en-env')).toBeVisible()
    await expect(page.locator('.en-avatar')).toBeVisible()
  })

  test('3-column layout renders (ctx / work / ai)', async ({ page }) => {
    await expect(page.locator('.en-col.ctx')).toBeVisible()
    await expect(page.locator('.en-col.work')).toBeVisible()
    await expect(page.locator('.en-col.ai')).toBeVisible()
  })

  test('submitted documents panel renders in left column', async ({ page }) => {
    await expect(page.locator('.en-col.ctx')).toContainText('Submitted documents')
    await expect(page.locator('[data-testid^="doc-view-"]').first()).toBeVisible()
  })

  test('clicking "View →" on a document opens the content modal', async ({ page }) => {
    await page.locator('[data-testid^="doc-view-"]').first().click()
    await expect(page.locator('.en-modal-card')).toBeVisible()
    await expect(page.locator('.en-modal-title')).toBeVisible()
    // close via the X button (scrim click hits card center due to flex centering)
    await page.locator('.en-iconbtn[aria-label="Close document"]').click()
    await expect(page.locator('.en-modal-card')).not.toBeVisible()
  })

  test('criteria accordion renders and toggles open', async ({ page }) => {
    const firstCrit = page.locator('.en-crit').first()
    await expect(firstCrit).toBeVisible()
    const header = firstCrit.locator('.en-crit-h')
    await header.click()
    await expect(firstCrit).toHaveClass(/open/)
    // toggle closed
    await header.click()
    await expect(firstCrit).not.toHaveClass(/open/)
  })

  test('gap criterion shows "Request this documentation" button', async ({ page }) => {
    // The gap criterion (crit-02) is inside .en-crit-b which is hidden until accordion opens
    // Open the gap criterion accordion (second .en-crit item)
    const gapCrit = page.locator('.en-crit').nth(1)
    await gapCrit.locator('.en-crit-h').click()
    await expect(gapCrit).toHaveClass(/open/)
    await expect(page.locator('.en-mini-rfi').first()).toBeVisible()
  })

  test('gap criterion RFI button opens modal pre-populated and closes via Cancel', async ({ page }) => {
    // Open the gap criterion accordion first
    const gapCrit = page.locator('.en-crit').nth(1)
    await gapCrit.locator('.en-crit-h').click()
    await expect(gapCrit).toHaveClass(/open/)
    await page.locator('.en-mini-rfi').first().click()
    await expect(page.locator('.en-modal-card')).toBeVisible()
    await expect(page.locator('#rfi-question')).not.toHaveValue('')
    // close via Cancel
    await page.locator('.en-modal-f .en-act:not(.primary)').click()
    await expect(page.locator('.en-modal-card')).not.toBeVisible()
  })

  test('"Request info" button opens RFI modal with pause-clock warning', async ({ page }) => {
    await page.locator('.en-act.primary').first().click()
    await expect(page.locator('.en-modal-card')).toBeVisible()
    await expect(page.locator('.en-pausebar')).toBeVisible()
    await expect(page.locator('.en-pausebar')).toContainText('pauses the decision clock')
  })

  test('"Refer to MD" button POSTs and re-renders as MD view', async ({ page }) => {
    let escalated = false
    await page.route(`**/bff/cases/${CASE_ID}/decision`, async (route) => {
      escalated = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.route(`**/bff/cases/${CASE_ID}`, async (route) => {
      if (escalated) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            case_id: CASE_ID,
            status: 'md_review',
            urgency: 'standard',
            lob: 'commercial',
            member: { first_name: 'Jane', last_name: 'E2E', date_of_birth: '1980-01-01', mrn: 'MRN-001' },
            coverage: { payer_name: 'ACME Health', plan_id: 'PLAN-001', lob: 'commercial' },
            service_lines: [],
            events: [],
            sla: null,
          }),
        })
      } else {
        await route.continue()
      }
    })
    await page.goto(CASE_URL)
    await expect(page.locator('[data-testid="case-header"]')).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-testid="btn-refer-md"]').click()
    await expect(page.locator('.en-col.gate')).toBeVisible({ timeout: 8_000 })
  })

  test('timeline icon opens SlideOver drawer', async ({ page }) => {
    await page.locator('.en-iconbtn[aria-label="Case timeline"]').click()
    await expect(page.locator('.en-tl-drawer')).toHaveClass(/on/)
    await expect(page.locator('[data-testid="events-timeline"]')).toBeVisible()
  })

  test('timeline SlideOver closes on scrim click', async ({ page }) => {
    await page.locator('.en-iconbtn[aria-label="Case timeline"]').click()
    await expect(page.locator('.en-tl-drawer')).toHaveClass(/on/)
    await page.locator('.en-tl-scrim.on').click()
    await expect(page.locator('.en-tl-drawer')).not.toHaveClass(/on/)
  })

  test('timeline SlideOver closes via close button', async ({ page }) => {
    await page.locator('.en-iconbtn[aria-label="Case timeline"]').click()
    await expect(page.locator('.en-tl-drawer')).toHaveClass(/on/)
    await page.locator('.en-tl-drawer .en-iconbtn[aria-label="Close timeline"]').click()
    await expect(page.locator('.en-tl-drawer')).not.toHaveClass(/on/)
  })

  test('AI advisory column shows suggestions', async ({ page }) => {
    await expect(page.locator('.en-ai-card')).toBeVisible()
    await expect(page.locator('.en-sg').first()).toBeVisible()
  })

  test('accepting an AI suggestion marks it done', async ({ page }) => {
    await expect(page.locator('.en-sg').first()).not.toHaveClass(/done/)
    await page.locator('.en-sg').first().locator('.go').click()
    await expect(page.locator('.en-sg').first()).toHaveClass(/done/)
  })

  test('AI boundary statement is visible', async ({ page }) => {
    await expect(page.locator('.en-boundary')).toContainText('Cannot issue a determination')
  })
})

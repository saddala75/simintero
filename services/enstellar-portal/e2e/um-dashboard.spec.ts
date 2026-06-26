import { test, expect } from '@playwright/test'

test.describe('Phase 2 — UM-home dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/queues/default/worklist')
    // Wait for worklist data before each test (both items from fixture)
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })
  })

  test('stat band renders: "In queue" shows total worklist count', async ({ page }) => {
    // The fixture has 2 items; "In queue" = total = 2 (first .en-stat tile)
    await expect(page.locator('.en-stat').first().locator('.v')).toContainText('2')
    // All 5 stat tiles + the gauge card are present
    await expect(page.locator('.en-stat')).toHaveCount(5)
    await expect(page.locator('.en-gauge-card')).toBeVisible()
  })

  test('gauge card shows SLA compliance from /stats endpoint', async ({ page }) => {
    // /stats returns sla_compliance_expedited_pct: 96.0 → WorklistPage renders "{slaPct.toFixed(1)}%"
    await expect(page.locator('.en-gauge-card .gv')).toContainText('96')
  })

  test('"All" tab shows all fixture rows', async ({ page }) => {
    // "All" is the default active tab
    await expect(page.locator('tbody tr')).toHaveCount(2)
  })

  test('"In review" tab filters to clinical_review rows only', async ({ page }) => {
    await page.getByRole('button', { name: /In review/i }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    // The clinical_review row has a review-variant state badge
    await expect(page.locator('.en-stbadge.review')).toBeVisible()
  })

  test('"Pending determination" tab filters to md_review rows only', async ({ page }) => {
    await page.getByRole('button', { name: /Pending determination/i }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('.en-stbadge.md')).toBeVisible()
  })

  test('"Awaiting info" tab shows empty state (no pend_rfi items in fixture)', async ({ page }) => {
    await page.getByRole('button', { name: /Awaiting info/i }).click()
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await expect(page.locator('.en-queue')).toContainText('No cases in this view.')
  })

  test('escalation rail shows the md_review case', async ({ page }) => {
    // First rail-card is "Pending MD determination"
    await expect(page.locator('.en-rail-card').first().locator('.t')).toContainText('Pending MD determination')
    // Exactly one md_review item in the fixture → one escalation button
    await expect(page.locator('.en-esc')).toHaveCount(1)
  })

  test('escalation rail item click navigates to the md_review case', async ({ page }) => {
    await page.locator('.en-esc').first().click()
    await expect(page).toHaveURL(/\/cases\//)
  })

  test('worklist row click navigates to the case workspace', async ({ page }) => {
    await page.locator('tbody tr').first().click()
    await expect(page).toHaveURL(/\/cases\//)
  })

  test('governed-AI guardrails panel renders the AI boundary statement', async ({ page }) => {
    // Second rail-card is the AI guardrails panel
    await expect(page.locator('.en-ai-stat')).toBeVisible()
    await expect(page.locator('.en-ai-bound')).toContainText('AI never issues a determination')
  })
})

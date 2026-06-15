import { test, expect } from '@playwright/test'

test('DTR form renders the questionnaire, accepts input, and submits', async ({ page }) => {
  await page.goto('/dtr?context=svc-1&plan=plan-1')
  await expect(page.getByTestId('dtr-form')).toBeVisible()
  await page.getByTestId('dtr-item-indication').fill('Chronic low back pain')
  await page.getByTestId('dtr-item-tried-conservative').check()
  await page.getByTestId('dtr-item-diagnosis').fill('M54.5')
  await page.getByTestId('dtr-submit').click()
  await expect(page.getByTestId('dtr-submitted')).toBeVisible()
})

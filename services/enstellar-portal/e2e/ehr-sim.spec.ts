import { test, expect } from '@playwright/test'

test('EHR simulator fires a CDS hook and shows a DTR-launch card', async ({ page }) => {
  await page.goto('/ehr-sim')
  await page.getByTestId('crd-fire').click()
  await expect(page.getByTestId('crd-card').first()).toBeVisible()
  await expect(page.getByTestId('crd-dtr-launch').first()).toBeVisible()
})

test('CRD card DTR-launch navigates to the DTR form (CRD->DTR seam)', async ({ page }) => {
  await page.goto('/ehr-sim')
  await page.getByTestId('crd-fire').click()
  await page.getByTestId('crd-dtr-launch').first().click()
  // lands on the DTR page carrying the ordered service as ?context=
  await expect(page).toHaveURL(/\/dtr\?context=/)
  await expect(page.getByTestId('dtr-form')).toBeVisible()
})

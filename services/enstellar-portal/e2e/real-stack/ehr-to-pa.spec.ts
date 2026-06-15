import { test, expect, request as playwrightRequest } from '@playwright/test'
import fs from 'fs'
import path from 'path'

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadManifest(): Record<string, string> {
  const manifestPath =
    process.env.E2E_MANIFEST ??
    path.resolve(__dirname, '../../../../infra/compose/e2e-fixture-manifest.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
}

async function getToken(): Promise<string> {
  const ctx = await playwrightRequest.newContext()
  try {
    const resp = await ctx.post(
      'http://localhost:8081/realms/enstellar/protocol/openid-connect/token',
      {
        form: {
          grant_type: 'password',
          client_id: 'enstellar-test-client',
          client_secret: process.env.TEST_CLIENT_SECRET ?? 'test-secret',
          username: process.env.E2E_USER ?? 'e2e-reviewer',
          password: process.env.E2E_PASSWORD ?? 'e2e-pass',
        },
      }
    )
    if (!resp.ok()) {
      const text = await resp.text()
      throw new Error(`Keycloak token request failed ${resp.status()}: ${text}`)
    }
    const body = await resp.json()
    return body.access_token as string
  } finally {
    await ctx.dispose()
  }
}

async function waitForCaseState(
  caseId: string,
  token: string,
  target: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const ctx = await playwrightRequest.newContext()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const resp = await ctx.get(`http://localhost:8001/bff/cases/${caseId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Id': 'tenant-dev',
        },
      })
      if (resp.ok()) {
        const data = (await resp.json()) as Record<string, unknown>
        if (data['status'] === target) return data
      }
      await new Promise(r => setTimeout(r, 2000))
    }
    throw new Error(`Case ${caseId} did not reach '${target}' within ${timeoutMs}ms`)
  } finally {
    await ctx.dispose()
  }
}

// ── Test ───────────────────────────────────────────────────────────────────────

let manifest: Record<string, string>
let token: string

test.beforeAll(async () => {
  manifest = loadManifest()
  token = await getToken()
})

test('CRD → DTR → PAS full lifecycle', async ({ page }) => {
  // Inject auth token so all BFF calls from the browser are authenticated
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${token}` })

  // ── 1. Fire CDS Hook via EHR sim ────────────────────────────────────────────
  await page.goto('/ehr-sim')
  await page.waitForLoadState('networkidle')

  // Fill patient ID — try data-testid first, then name/placeholder fallbacks
  const patientInput = page.locator(
    '[data-testid="patient-id-input"], input[name="patientId"], input[placeholder*="patient" i], input[placeholder*="Patient" i]'
  ).first()
  await patientInput.fill(manifest['patient_id'])

  // Fill service code
  const serviceInput = page.locator(
    '[data-testid="service-code-input"], input[name="serviceCode"], input[placeholder*="service" i], input[placeholder*="CPT" i]'
  ).first()
  await serviceInput.fill('99213')

  // Submit the CDS hook request
  await page.click(
    'button:has-text("Check"), button:has-text("Submit"), button[type="submit"]'
  )

  // ── 2. Assert CRD card appears ──────────────────────────────────────────────
  const cardLocator = page.locator(
    '[data-testid="crd-card"], [class*="CrdCard"], [class*="crd-card"], .card'
  ).first()
  await expect(cardLocator).toBeVisible({ timeout: 15_000 })

  // ── 3. Launch DTR ────────────────────────────────────────────────────────────
  const dtrLink = page.locator(
    '[data-testid="dtr-launch-link"], a:has-text("DTR"), a:has-text("Documentation"), button:has-text("DTR")'
  ).first()
  await expect(dtrLink).toBeVisible({ timeout: 5_000 })
  await dtrLink.click()

  // Wait for DTR form to load
  await page.waitForURL('**/dtr**', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')

  // ── 4. Fill and submit questionnaire ─────────────────────────────────────────
  // Fill any required text inputs
  const textInputs = page.locator('input[type="text"], textarea')
  const textCount = await textInputs.count()
  for (let i = 0; i < textCount; i++) {
    const input = textInputs.nth(i)
    const isVisible = await input.isVisible()
    const isDisabled = await input.isDisabled()
    const isReadOnly = await input.evaluate((el: HTMLInputElement) => el.readOnly)
    if (isVisible && !isDisabled && !isReadOnly) {
      await input.fill(i === 0 ? 'Chronic low back pain' : 'M54.5')
    }
  }

  // Check any required checkboxes
  const checkboxes = page.locator(
    '[data-testid="questionnaire-form"] input[type="checkbox"], form input[type="checkbox"]'
  )
  const cbCount = await checkboxes.count()
  for (let i = 0; i < cbCount; i++) {
    const cb = checkboxes.nth(i)
    const isVisible = await cb.isVisible()
    if (isVisible) {
      await cb.check()
    }
  }

  // Submit the questionnaire
  await page.click('button:has-text("Submit"), button[type="submit"]')
  await page.waitForLoadState('networkidle')

  // Assert no error banner
  await expect(
    page.locator('[role="alert"][class*="error"], [class*="error-banner"], [data-testid="error"]')
  ).toHaveCount(0)

  // ── 5. Poll workflow for approved ────────────────────────────────────────────
  const caseId = manifest['case_id']
  expect(caseId).toBeTruthy()
  const caseData = await waitForCaseState(caseId, token, 'approved', 60_000)
  expect(caseData['status']).toBe('approved')

  // ── 6. Assert $inquire returns complete ClaimResponse ────────────────────────
  const correlationId = manifest['correlation_id']
  const apiCtx = await playwrightRequest.newContext()
  try {
    const inquireResp = await apiCtx.get(
      `http://localhost:8080/fhir/Claim/${correlationId}/$inquire`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
          'X-Tenant-Id': 'tenant-dev',
        },
      }
    )
    expect(inquireResp.ok()).toBe(true)
    const inquireBundle = (await inquireResp.json()) as Record<string, unknown>
    const entries = (inquireBundle['entry'] as unknown[]) ?? []
    const claimResponse = entries
      .map(e => (e as Record<string, unknown>)['resource'] as Record<string, unknown>)
      .find(r => r?.['resourceType'] === 'ClaimResponse')
    expect(claimResponse).toBeTruthy()
    expect(claimResponse!['outcome']).toBe('complete')
  } finally {
    await apiCtx.dispose()
  }
})

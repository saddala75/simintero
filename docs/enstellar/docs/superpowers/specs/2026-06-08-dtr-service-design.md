# DTR (Documentation Templates & Rules) — Design

**Status:** Approved (2026-06-08). Sub-project #3 of the design-partner readiness program (`docs/superpowers/specs/2026-06-08-design-partner-readiness-program-design.md`). Builds on the component spec `.claude/specs/crd-dtr.md`. Pairs with the CRD design (`2026-06-08-crd-cds-hooks-design.md`); DTR is launched from a CRD card and feeds PAS `$submit`.

**Goal:** Serve Da Vinci DTR documentation artifacts (FHIR `Questionnaire` + CQL) and accept the completed `QuestionnaireResponse`, attaching it to the case and handing it into the PAS submission. For the pilot, an in-house DTR renderer (LHC-Forms) completes the form so CRD→DTR→PAS runs end-to-end without a real EHR.

## Locked decisions
- **CQL executes client-side** (in the EHR/DTR app or our in-house renderer). Enstellar **serves** the Questionnaire+CQL package; it does **not** run a CQL engine.
- DTR content (Questionnaire + CQL Library) comes from **Digicore** — add a Questionnaire endpoint to the mock.
- In-house renderer: **LHC-Forms (`@lhncbc/lforms`)** in `apps/web` (de-facto FHIR Questionnaire/SDC renderer with prepopulation), rather than a hand-rolled form.
- Pinned IG: **Da Vinci DTR 2.0.1** (aligned with US Core 5.0.1 + PAS 2.0.1).
- **Advisory only** — DTR captures documentation; it never makes a determination.

## Architecture
DTR lives in the JVM interop tier as a Spring package `com.simintero.enstellar.interop.dtr` (sibling of `pas/`, `crd/`). It exposes a small FHIR-flavored surface plus a SMART launch endpoint.

Flow: CRD PA-required card → DTR launch → renderer fetches the `Questionnaire` (DTR → Digicore mock) → LHC-Forms renders + prepopulates (client-side CQL/SDC) → user completes → `POST QuestionnaireResponse` → DTR validates, links it to the case, and includes it in the PAS `$submit` bundle → existing PAS pipeline runs.

### Interfaces
- `GET /fhir/Questionnaire?context={serviceCode}&plan={planId}` — returns the DTR `Questionnaire` (with embedded/linked CQL `Library`) fetched from Digicore. Not cached past its `effectivePeriod`/effective date.
- `POST /fhir/QuestionnaireResponse` — accepts the completed `QuestionnaireResponse`; validates against the Questionnaire; links to a case (creates or attaches); triggers/augments the PAS `$submit` bundle (QR added as supporting documentation). Returns the created QR (or an `OperationOutcome` on validation failure).
- `GET /dtr/launch?iss={fhirBase}&launch={launchToken}` — SMART app launch entry; resolves context and redirects/handshakes to the renderer (in-house renderer for the pilot; a partner's DTR app via standard SMART launch later).

### DTR → PAS handoff
- On `QuestionnaireResponse` submit, DTR assembles (or updates) the PAS request Bundle so the QR travels as supporting documentation into the existing `pas` `$submit` provider. Reuse the existing PAS submit path; do not fork it. The case linkage uses the existing case/decision model.

### Tenant + security + PHI
- Tenant resolved from the launch context / request and propagated on the Digicore fetch, the case link, all events, and logs.
- PHI minimum-necessary: prepopulation context passed to the renderer is the minimum needed; no PHI logged in the clear.
- Advisory-only enforced by construction (serves forms / stores responses; no determination path).

### In-house DTR renderer (pilot)
- `apps/web`: a DTR page that loads `@lhncbc/lforms`, fetches the Questionnaire via BFF, renders + prepopulates, and submits the `QuestionnaireResponse` via BFF. Reached from the CRD sim's DTR-launch card.
- `portal-bff`: `/bff/dtr/...` routes proxying Questionnaire GET and QuestionnaireResponse POST to DTR.

### Digicore mock
- Add `GET /api/v1/questionnaire?context=...&plan=...` to `mock-digicore` returning a representative Da Vinci DTR `Questionnaire` (+ a CQL `Library`, base64 or contained) for at least the reference service code(s). Keep it representative so a real Digicore is a URL swap.

## File structure (create/modify)
- Create `services/interop/.../dtr/` — `DtrController` (Questionnaire GET, QuestionnaireResponse POST, `/dtr/launch`), `DigicoreQuestionnaireClient`, `QuestionnaireResponseValidator`, `PasBundleAssembler` (QR → PAS bundle), `DtrConfig`.
- Modify the existing `pas` submit path only as needed to accept a QR as supporting documentation (no fork).
- Modify `infra/compose/mocks/digicore/main.py` — add `/api/v1/questionnaire`.
- Modify `services/portal-bff` — add `dtr` router.
- Modify `apps/web` — add LHC-Forms dependency + DTR renderer page + route; wire the CRD card's DTR-launch to it.
- Tests: `DtrQuestionnaireIT`, `DtrQuestionnaireResponseIT` (WireMock'd Digicore + PAS handoff), `PasBundleAssemblerTest` (unit).

## Definition of Done
- `GET /fhir/Questionnaire` returns the Digicore-sourced Questionnaire(+CQL) for the reference context; respects effective date (no stale cache).
- `POST /fhir/QuestionnaireResponse` validates, links to the correct case, and the QR appears in the resulting PAS `$submit` bundle; invalid QR → `OperationOutcome` 4xx.
- `GET /dtr/launch` resolves context and reaches the renderer.
- In-house renderer: from a CRD PA-required card, launch DTR, LHC-Forms renders + prepopulates the Questionnaire, submit → QR stored → PAS submission proceeds (closes CRD→DTR→PAS).
- Tenant propagated; no PHI in logs; advisory-only.
- Unit + IT green; DTR added to the conformance gate (#4) when its Inferno kit lands.

## Testing
- Unit: `PasBundleAssembler` (QR → PAS bundle), `QuestionnaireResponseValidator`.
- IT: DTR Questionnaire GET + QuestionnaireResponse POST against WireMock-stubbed Digicore, asserting PAS handoff (mirrors FhirTestBase WireMock pattern).
- e2e (sub-project #6): full CRD→DTR→PAS→determination→ClaimResponse via the in-house sim.

## Out of scope / open
- Server-side CQL execution (explicitly client-side).
- Real EHR/partner DTR app integration via standard SMART launch (pilot uses the in-house renderer; standard launch endpoint is provided for later).
- Inferno DTR test-kit wiring — folded into sub-project #4 when versions are pinned.

## Parallel-execution note (CRD + DTR)
CRD and DTR are built in parallel on isolated worktree branches. Shared touchpoints requiring a short integration pass: `portal-bff` (separate `crd`/`dtr` routers — low conflict), `apps/web` (CRD sim page vs DTR renderer page + a shared route/nav entry), `infra/compose/mocks/digicore/main.py` (separate `/api/v1/crd` vs `/api/v1/questionnaire` endpoints — low conflict), and `docker-compose.yml`/deps. Plan the web nav + any shared scaffolding once and have both plans reference it to minimize merge conflicts.

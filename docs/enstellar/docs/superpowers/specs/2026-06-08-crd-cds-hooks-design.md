# CRD (Coverage Requirements Discovery) — Design

**Status:** Approved (2026-06-08). Sub-project #2 of the design-partner readiness program (`docs/superpowers/specs/2026-06-08-design-partner-readiness-program-design.md`). Builds on the component spec `.claude/specs/crd-dtr.md`. Pairs with the DTR design (`2026-06-08-dtr-service-design.md`); CRD cards launch DTR.

**Goal:** Expose standards-conformant Da Vinci CRD via CDS Hooks so a provider's EHR, at order time, learns whether prior auth is required and what documentation is needed — returning advisory cards (one of which launches DTR). For the pilot, the path is also exercised by an in-house EHR simulator.

## Locked decisions
- Hooks: `order-select`, `order-sign`, `appointment-book`, plus discovery. (CDS Hooks **2.0**.)
- Card content comes from **Digicore** (the mock already exposes `GET /api/v1/crd`).
- In-house EHR simulator drives the path for the pilot (no real EHR yet); the endpoints stay standards-conformant for the partner's real EHR.
- Pinned IG: **Da Vinci CRD 2.0.1** (aligned with US Core 5.0.1 + PAS 2.0.1 already loaded in HAPI).
- **Advisory only** — CRD returns information cards; it never makes or is the basis for a determination.

## Architecture
CRD lives in the JVM interop tier as a Spring `@RestController` package `com.simintero.enstellar.interop.crd` (sibling of `pas/`). It is **not** a FHIR RestfulServer resource — CDS Hooks is a separate REST surface mounted outside `/fhir`.

Flow: EHR (or the sim) → `POST /cds-services/{id}` with a CDS Hooks request (context + optional `prefetch`/`fhirAuthorization`) → CRD validates the request, resolves the tenant, extracts the ordered service code + member/plan, calls `DigicoreCrdClient.getCrdContent(...)` (→ mock `GET /api/v1/crd`), maps the Digicore CRD content to CDS Hooks **Cards**, and returns `{ "cards": [...] }`.

### Interfaces
- `GET /cds-services` — discovery; returns the service list (id, hook, title, description, optional `prefetch` templates) for the three hooks.
- `POST /cds-services/order-select` · `/order-sign` · `/appointment-book` — invoke; request per CDS Hooks 2.0 (`hook`, `hookInstance`, `context`, optional `prefetch`, optional `fhirAuthorization`); response `{ cards: Card[], systemActions?: [] }`.
- Cards produced (mapped from Digicore CRD content):
  - **PA required** — summary + `detail`; includes a **DTR launch** `link` (`type: "smart"`, `url` → DTR `GET /dtr/launch`, with `appContext`).
  - **PA not required** — with the governing rule reference (card `source`/extension carries the Digicore trace id).
  - **Alternatives** — suggested covered alternatives, when Digicore returns them.
  - **Documentation requirements** — what's needed, as an info card.
- Every card carries `source` and a trace reference (Digicore decision/trace id) in a card extension for provenance.

### Tenant + security
- Tenant is resolved from the CDS Hooks request (the sim sends it via a configured context/header; a real EHR maps via the registered hook/client → tenant). Propagated on the Digicore call, all events, and logs.
- `fhirAuthorization` (SMART backend token) and `prefetch` are validated before any callback to the EHR FHIR server; **PHI minimum-necessary** — only the prefetch needed for the rule lookup.
- The CDS Hooks surface is `permitAll` at the transport layer but each request must carry a resolvable tenant; no determination logic, so no adverse-action guard applies — but the advisory-only invariant is enforced by construction (cards only).

### In-house EHR simulator (CRD portion)
- `apps/web`: a "Simulate EHR order" page — pick service code / member / plan / hook, fire it (→ BFF → CRD), render the returned cards (including the DTR-launch button that hands off to the DTR renderer in the DTR spec).
- `portal-bff`: a `/bff/crd/...` route that proxies a hook invocation to CRD (the browser never calls CDS Hooks directly in the sim).

### Digicore mock
- Reuse the existing `GET /api/v1/crd`. Extend its `CRDContent` model only if needed to cover all four card types (PA-required/not-required/alternatives/documentation) and a trace id. Keep it representative so a real Digicore is a URL swap.

## File structure (create/modify)
- Create `services/interop/src/main/java/com/simintero/enstellar/interop/crd/` — `CdsServicesController` (discovery + invoke), `CdsHooksRequest`/`Card` DTOs, `CrdCardMapper`, `CrdConfig`.
- Create `services/integration-connectors/.../digicore` CRD client method `get_crd_content` if not already present (used by interop via HTTP to the mock; interop has its own Java client — add `DigicoreCrdClient`).
- Modify `infra/compose/mocks/digicore/main.py` — extend `/api/v1/crd` content if needed.
- Modify `services/portal-bff` — add `crd` router.
- Modify `apps/web` — add the "Simulate EHR order" page + cards view + route/nav.
- Tests: `CdsServicesIT` (discovery + 3 hooks via WireMock'd Digicore), `CrdCardMapperTest` (unit).

## Definition of Done
- `GET /cds-services` returns a valid CDS Hooks 2.0 service list (3 hooks).
- `order-select`/`order-sign`/`appointment-book` each return correct cards for the three reference contexts (PA required w/ DTR launch, PA not required w/ rule ref, documentation requirements).
- Digicore called correctly; trace id present in a card extension.
- `fhirAuthorization`/prefetch validated before any EHR callback; no PHI logged in the clear; tenant propagated.
- In-house sim: fire a hook from `apps/web`, see cards, click DTR launch → hands off to DTR.
- Unit + IT green; CRD added to the conformance gate (sub-project #4) when its Inferno/CDS-Hooks kit lands.

## Testing
- Unit: `CrdCardMapper` (Digicore content → each card type).
- IT: `CdsServicesIT` against WireMock-stubbed Digicore (mirrors the FhirTestBase WireMock pattern).
- Conformance: CDS Hooks discovery shape + (later) Inferno CRD test kit in `make conformance`.

## Out of scope / open
- Real EHR registration & SMART backend-services client credential flow (pilot uses the sim + mock; partner EHR onboarding later).
- `systemActions` (CDS Hooks 2.0 write-back) — not needed for advisory cards in the pilot.
- Inferno CRD test-kit wiring — folded into sub-project #4 when versions are pinned.

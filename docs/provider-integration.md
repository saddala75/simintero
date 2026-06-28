# Provider Integration Guide

How healthcare providers submit prior authorization requests and supporting documents to this payer platform.

Three integration modes are supported:

| Mode | Best for | Auth |
|------|----------|------|
| [Provider Portal](#1-provider-portal-integration) | Human-driven submissions from a web app | Client credentials → JWT |
| [SMART on FHIR](#2-smart-on-fhir-app-integration) | EHR-embedded apps; real-time coverage discovery | SMART launch (EHR-brokered) |
| [Direct API](#3-direct-api-integration) | System-to-system, automated pipelines | Client credentials → JWT |

---

## Platform endpoints

All FHIR and interop traffic goes through the interop service.

| Endpoint | Base URL (local dev) | Auth required |
|----------|----------------------|---------------|
| FHIR capability statement | `GET http://localhost:8080/fhir/metadata` | No |
| SMART configuration | `GET http://localhost:8080/.well-known/smart-configuration` | No |
| Prior auth submission | `POST http://localhost:8080/fhir/Claim/$submit` | JWT Bearer |
| CRD discovery | `GET http://localhost:8080/cds-services` | No |
| CRD hook invoke | `POST http://localhost:8080/cds-services/{hook-id}` | No (EHR passes fhirAuthorization in body) |
| DTR launch | `GET http://localhost:8080/dtr/launch?iss=...&launch=...` | No |
| DTR questionnaire | `GET http://localhost:8080/fhir/Questionnaire?context={code}&plan={planId}` | JWT Bearer |
| Identity server | `http://localhost:8081/realms/simintero` | — |

**Production:** replace `localhost:8080` with your payer platform hostname and `localhost:8081` with the Keycloak hostname.

---

## Keycloak client setup

Before integrating, the payer platform operator must register a Keycloak client for each provider system.

**What the operator configures:**

```
Realm:              simintero
Client ID:          <provider-org-id>-pa-client   (e.g. acme-health-pa-client)
Client secret:      <generated — shared with provider>
Grant type:         Client credentials
Service accounts:   Enabled
Audience:           enstellar-api   (mapped in token via audience mapper)
```

**What the provider receives:**

- `client_id` — their client identifier
- `client_secret` — keep secret, rotate periodically
- `tenant_id` — the payer tenant identifier to include on API calls
- Base URL of the interop service

---

## 1. Provider Portal Integration

For a provider-facing web portal that submits to this payer platform on behalf of clinicians.

### Auth flow

The portal backend makes a client credentials grant to Keycloak, then calls the payer API using the resulting JWT. Never expose the client secret to the browser.

```
Provider Portal Backend
        │
        ├─ POST /realms/simintero/protocol/openid-connect/token
        │      grant_type=client_credentials
        │      client_id=acme-health-pa-client
        │      client_secret=<secret>
        │
        │◄─── { access_token: "eyJ...", expires_in: 300 }
        │
        └─ POST /fhir/Claim/$submit
               Authorization: Bearer eyJ...
               Content-Type: application/fhir+json
               { FHIR R4 PAS Bundle }
```

```bash
# Step 1: get a token (server-side only)
TOKEN=$(curl -sf -X POST \
  http://localhost:8081/realms/simintero/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=acme-health-pa-client \
  -d client_secret=<secret> \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Step 2: submit PA request
curl -X POST http://localhost:8080/fhir/Claim/$submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d @pa_bundle.json
```

Token lifetime: 300 seconds. Cache it; refresh before expiry.

### FHIR PAS bundle structure

The `$submit` operation accepts a FHIR R4 `Bundle` of type `collection` conforming to the [Da Vinci PAS](https://hl7.org/fhir/us/davinci-pas/) profile.

Minimum required resources:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Claim",
        "status": "active",
        "use": "preauthorization",
        "patient": { "reference": "Patient/member-123" },
        "provider": { "reference": "Practitioner/dr-jones" },
        "insurer": { "reference": "Organization/payer-001" },
        "item": [{
          "sequence": 1,
          "productOrService": {
            "coding": [{ "system": "http://www.ama-assn.org/go/cpt", "code": "29826" }]
          }
        }]
      }
    },
    { "resource": { "resourceType": "Patient", "id": "member-123", ... } },
    { "resource": { "resourceType": "Practitioner", "id": "dr-jones", ... } }
  ]
}
```

**Response:** `ClaimResponse` with `outcome: queued` and a `correlationId` to track the case.

```json
{
  "resourceType": "ClaimResponse",
  "outcome": "queued",
  "identifier": [{ "system": "urn:simintero:case", "value": "<correlation_id>" }]
}
```

### Attaching clinical documents

Include supporting documents **in the same bundle** as additional entries. The platform auto-ingests them and links them to the case.

**Binary (e.g., a PDF clinical note):**

```json
{
  "resource": {
    "resourceType": "Binary",
    "contentType": "application/pdf",
    "data": "<base64-encoded PDF>"
  }
}
```

**DocumentReference (structured metadata + content pointer):**

```json
{
  "resource": {
    "resourceType": "DocumentReference",
    "status": "current",
    "type": {
      "coding": [{ "system": "http://loinc.org", "code": "34133-9", "display": "Summary of episode note" }]
    },
    "content": [{
      "attachment": {
        "contentType": "application/pdf",
        "data": "<base64-encoded PDF>"
      }
    }]
  }
}
```

**QuestionnaireResponse (DTR-completed form — see Mode 2):**

```json
{
  "resource": {
    "resourceType": "QuestionnaireResponse",
    "status": "completed",
    "questionnaire": "http://example.org/Questionnaire/pa-form",
    "item": [ ... ]
  }
}
```

All three resource types are automatically extracted and stored against the case. Document ingestion is best-effort — a malformed document will not fail the `$submit`.

### Submitting additional documents after case creation

To add documents to an existing case, re-submit a minimal bundle with the `correlationId` as an identifier on the `Claim`:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Claim",
        "identifier": [{ "system": "urn:simintero:case", "value": "<correlation_id>" }],
        "status": "active",
        "use": "preauthorization",
        ...
      }
    },
    { "resource": { "resourceType": "Binary", ... } }
  ]
}
```

### Tracking status

After submission, poll the BFF API for case status. The BFF is a separate service — providers need a separate JWT audience configured, or the portal operator can proxy status queries server-side.

```bash
curl http://localhost:8001/cases/<correlation_id> \
  -H "Authorization: Bearer $PORTAL_TOKEN"
```

Status lifecycle: `submitted` → `clinical_review` → `approved` / `denied` / `pending_rfi`

If status is `pending_rfi`, the case has an open Request for Information — the provider should respond with additional documents using the additional-document submission flow above.

---

## 2. SMART on FHIR App Integration

For EHR-embedded apps that surface coverage requirements and documentation templates at the point of care, before a PA is filed.

### What this platform provides

| Da Vinci Capability | What it does | Endpoint |
|---------------------|--------------|----------|
| **CRD** (Coverage Requirements Discovery) | Returns advisory cards when a clinician orders a service — tells them if PA is needed, what documentation is required | `GET /cds-services`, `POST /cds-services/{id}` |
| **DTR** (Documentation Templates and Rules) | Serves the questionnaire for PA documentation; SMART-launched from within the EHR | `GET /dtr/launch`, `GET /fhir/Questionnaire` |
| **PAS** (Prior Auth Support) | Submits the PA request with DTR-completed documentation | `POST /fhir/Claim/$submit` |

### CRD — Coverage Requirements Discovery

CRD runs at order time, before PA is filed. The EHR calls the CDS Hooks endpoint for real-time guidance.

**Step 1: EHR discovers hooks**

```
GET /cds-services
```

Response lists supported hooks:

```json
{
  "services": [
    { "hook": "order-select", "id": "pa-crd-order-select", "title": "PA Coverage Requirements - Order Select" },
    { "hook": "order-sign",   "id": "pa-crd-order-sign",   "title": "PA Coverage Requirements - Order Sign" },
    { "hook": "appointment-book", "id": "pa-crd-appointment-book", "title": "PA Coverage Requirements - Appointment Book" }
  ]
}
```

**Step 2: EHR invokes a hook**

```
POST /cds-services/pa-crd-order-sign
Content-Type: application/json
X-Tenant-Id: <tenant_id>

{
  "hookInstance": "...",
  "hook": "order-sign",
  "context": {
    "userId": "Practitioner/dr-jones",
    "patientId": "Patient/member-123",
    "draftOrders": { ... }
  },
  "fhirServer": "http://ehr.example.org/fhir",
  "fhirAuthorization": {
    "access_token": "<EHR-issued token for FHIR server>",
    "token_type": "Bearer",
    "scope": "patient/*.read"
  }
}
```

Note: CDS Hooks transport is **unauthenticated** — the EHR passes its own FHIR authorization in the request body. Tenant routing uses the `X-Tenant-Id` header.

**Response:** CDS Cards with links and suggestions

```json
{
  "cards": [
    {
      "summary": "Prior Authorization Required for CPT 29826",
      "indicator": "warning",
      "source": { "label": "Payer Coverage Policy" },
      "suggestions": [
        {
          "label": "Launch Documentation Template",
          "actions": [{ "type": "create", "resource": { ... } }]
        }
      ],
      "links": [
        {
          "label": "Complete Documentation Template",
          "url": "http://localhost:8080/dtr/launch?iss=...&launch=...",
          "type": "smart"
        }
      ]
    }
  ]
}
```

Cards are **advisory only** — they inform, never approve or deny.

### DTR — Documentation Templates and Rules

After CRD identifies a PA requirement, the EHR launches the DTR SMART app to collect documentation.

**Step 1: SMART configuration discovery**

```
GET /.well-known/smart-configuration
```

Returns OIDC endpoints the EHR uses to authorize the SMART app.

**Step 2: EHR launches DTR app**

The EHR opens the SMART link from the CRD card:

```
GET /dtr/launch?iss=http://ehr.example.org/fhir&launch=<launch-token>
```

Response:

```json
{
  "renderer": "http://localhost:8080/dtr/render",
  "iss": "http://ehr.example.org/fhir",
  "launch": "<launch-token>"
}
```

**Step 3: DTR app fetches questionnaire**

```
GET /fhir/Questionnaire?context=29826&plan=plan-001
Authorization: Bearer <JWT>
```

Returns a FHIR `Questionnaire` with embedded CQL. The CQL executes **client-side** in the DTR app against the EHR's FHIR server to pre-populate answers from existing clinical data.

**Step 4: Clinician completes the questionnaire**

The DTR app presents the questionnaire. The clinician reviews and confirms auto-populated answers, adds missing information.

**Step 5: Completed QuestionnaireResponse goes into the PAS bundle**

The DTR app hands the completed `QuestionnaireResponse` to the EHR's PA workflow, which includes it in the `$submit` bundle (see Mode 1 above). The platform auto-ingests it as a document linked to the case.

### SMART scopes required

The SMART app needs these scopes from the EHR:

```
launch patient/Patient.read patient/Condition.read
patient/Observation.read patient/MedicationRequest.read
```

---

## 3. Direct API Integration

For automated pipelines — practice management systems, clearinghouses, or other systems that submit PAs programmatically without human interaction.

### Auth

Same client credentials flow as Mode 1:

```bash
TOKEN=$(curl -sf -X POST \
  http://localhost:8081/realms/simintero/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=<client_id> \
  -d client_secret=<client_secret> \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

JWT claims:
- `iss`: `http://localhost:8081/realms/simintero`
- `aud`: must include `enstellar-api`
- `exp`: 300 seconds (cache and refresh proactively)

### Submit a PA request

```bash
curl -X POST http://localhost:8080/fhir/Claim/$submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [ ... ]
  }'
```

Extract the `correlationId` from the response for status polling.

### Poll for status

```bash
# Via workflow engine directly (internal)
docker compose exec postgres psql -U sim -d workflow \
  -c "SELECT correlation_id, status FROM workflow_instances WHERE correlation_id = '...';"
```

The BFF API (`/cases/{id}`) provides the external-facing status endpoint when deployed.

### Submit additional documents

Re-submit with the correlation ID in the `Claim.identifier` array (see Mode 1 additional-document pattern). Each re-submission is idempotent on the case — it only adds documents.

### Error codes

| HTTP status | Meaning |
|-------------|---------|
| `200` | `$submit` accepted; check `ClaimResponse.outcome` |
| `400` | Invalid FHIR bundle — check `OperationOutcome` in response body |
| `401` | Missing or expired JWT |
| `403` | JWT present but audience (`enstellar-api`) missing or tenant not authorized |
| `422` | Business validation failed — see `OperationOutcome` |

---

## What the payer platform operator must provide

For each integrating provider organization:

| Item | Details |
|------|---------|
| Keycloak `client_id` | Unique per org, registered in `simintero` realm |
| Keycloak `client_secret` | Generated on registration; delivered securely |
| `tenant_id` | Payer tenant identifier for `X-Tenant-Id` header (CRD) |
| Token endpoint | `http://<keycloak-host>/realms/simintero/protocol/openid-connect/token` |
| Interop base URL | `http://<interop-host>/` |
| FHIR capability statement | `GET <base>/fhir/metadata` |
| SMART configuration | `GET <base>/.well-known/smart-configuration` |
| CDS Hooks discovery | `GET <base>/cds-services` |
| Supported CPT/HCPCS codes | Which service codes trigger CRD/PA |
| FHIR IG profiles | Da Vinci PAS, CRD, DTR — linked below |

### FHIR IGs this platform implements

- [Da Vinci PAS R1](https://hl7.org/fhir/us/davinci-pas/) — `Claim/$submit`, `ClaimResponse`
- [Da Vinci CRD R2](https://hl7.org/fhir/us/davinci-crd/) — CDS Hooks + coverage cards
- [Da Vinci DTR R2](https://hl7.org/fhir/us/davinci-dtr/) — Questionnaire + QuestionnaireResponse
- [US Core R4](https://hl7.org/fhir/us/core/) — Patient, Practitioner, Organization base profiles
- [SMART App Launch 2.0](https://hl7.org/fhir/smart-app-launch/) — token endpoint, scopes

---

## Integration checklist

- [ ] Payer operator registers Keycloak client, provides credentials
- [ ] Provider system stores client secret securely (not in source code)
- [ ] Token fetch is server-side only (never in browser JS)
- [ ] Token is cached and refreshed before 300-second expiry
- [ ] FHIR bundle conforms to Da Vinci PAS profile (validate against `GET /fhir/metadata`)
- [ ] `correlationId` is stored for status polling and document additions
- [ ] For SMART/CRD: EHR is configured with CDS Hooks service URL
- [ ] For SMART/DTR: SMART app launch URL registered in EHR's app catalog
- [ ] For all modes: test in dev environment (`tenant-dev`) before production

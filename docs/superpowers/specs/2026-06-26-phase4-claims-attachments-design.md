# Phase 4 — CMS-0053-F Claims Attachments Design

**Date:** 2026-06-26
**Status:** Approved
**Roadmap phase:** Phase 4 (branches off Phase 2 — C-CDA + Revital folded in)

## Goal

Implement the CMS-0053-F Attachments Rule: structured electronic exchange of clinical documentation to evaluate and process **claims** (post-service / payment integrity). A claim pending documentation triggers a 277-RFAI to the provider; the provider returns an e-signed 275 carrying a C-CDA document via either a FHIR endpoint or X12 EDI channel; the platform verifies the signature, extracts grounded evidence via Revital, and surfaces it to the claims reviewer. Includes folded-in Phase 2 work: real C-CDA ingestion and Revital extraction on structured clinical documents.

## Architecture & Data Flow

```
Claims Service
  claim state → "pending_documentation"
  emits Kafka: claims.attachment.requested {claim_id, tenant_id, loinc_codes[]}
        │
        ▼
Interop Service  (attachment hub)
  ┌─ 277-RFAI Emitter ────────────────────────────────────────────────────┐
  │  consumes: claims.attachment.requested                                 │
  │  builds X12 v6020 277-RFAI transaction via RfaiBuilder                │
  │  sends via ClearinghouseRfaiClient (new Java RestTemplate bean)       │
  │  writes: interop.rfai_correlation row (rfai_id, claim_id,            │
  │          control_number, loinc_codes)                                 │
  └───────────────────────────────────────────────────────────────────────┘
        │   (provider responds — two inbound paths converge)
        │
  ┌─ 275 FHIR path ──────────────────────────────────────────────┐
  │  POST /fhir/DocumentReference/$attach (new HAPI operation)    │
  │  Bundle: DocumentReference + C-CDA Binary attachment          │
  │  relatesTo → 277 control_number                               │
  └──────────────────────────────────┐
                                     ▼
  ┌─ 275 X12 EDI path ────────────┐  │
  │  Kafka: clearinghouse.inbound  │  │
  │  X12v6020AttachmentParser      │  │
  │  extracts BIN segment → C-CDA  │  │
  │  extracts BGN02 → control_num  │  │
  └──────────────────────┐        │  │
                         ▼        ▼  ▼
  ┌─ AttachmentProcessor ─────────────────────────────────────────┐
  │  1. XMLDSig verify (Apache Santuario) — fail → reject + audit │
  │  2. store C-CDA bytes → MinIO (attachment/ prefix)            │
  │  3. correlate control_number → rfai_id → claim_id             │
  │  4. store to document service → doc_id returned               │
  │  5. update rfai_correlation: fulfilled_at, doc_id             │
  │  6. emit: claims.attachment.received {claim_id, doc_id, ...}  │
  └───────────────────────────────────────────────────────────────┘
        │
        ▼
Revital Pipeline  (Temporal)
  parseCcda activity: C-CDA XML → SpanMap (sections/entries as spans)
  → extractEntities → mapEvidenceToCriteria → summarizeGrounded
  → persistAdvisory (advisory_type = 'claims_attachment')
  emits: revital.advisory.persisted
        │
        ▼
Claims Service
  GET /v1/claims/:id/evidence → Revital advisory for reviewer
```

## Sub-Phase Decomposition

Phase 4 is implemented as two sequential plans:

- **4A — C-CDA pipeline + claims state machine:** `parseCcda` Revital activity, `RevitalAnalyzeCase` routing, `advisory_type` field, claims `documentation_status` column, `claims.attachment.requested` event, `/v1/claims/:id/evidence` endpoint, Revital advisory consumer. Testable end-to-end with a manually uploaded C-CDA before the protocol layer exists.
- **4B — Interop attachment hub:** `RfaiBuilder`, `X12v6020AttachmentParser`, `DocumentReference/$attach` HAPI operation, `AttachmentProcessor`, XMLDSig verification, `rfai_correlation` + `attachment_signature_audit` tables, `ClearinghouseInbound275Consumer`, `claims.attachment.requested` consumer → 277-RFAI send, `claims.attachment.received` emission.

The two plans wire together via Kafka: 4A reads events that 4B emits, and 4B reads events that 4A (claims service) emits. Integration is verified in 4B's e2e test.

---

## Section 1 — C-CDA Ingestion + Revital Pipeline (Phase 4A)

### New Revital activity: `parseCcda`

**File:** `modules/revital/pipeline/src/activities/parseCcda.ts`

Replaces `parseSegment` for C-CDA documents. Fetches raw C-CDA XML from the document service, parses it with `fast-xml-parser`, walks `ClinicalDocument/component/structuredBody/component[]`, and emits one `Span` per `<entry>` element within each section. Output shape is identical to `parseSegment`'s `SpanMap` — the rest of the pipeline is untouched.

```typescript
import { XMLParser } from 'fast-xml-parser'
import type { DocMeta } from './fetchDocuments.js'
import type { SpanMap, Span } from './parseSegment.js'
import crypto from 'node:crypto'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export async function parseCcda(docs: DocMeta[], tenantId: string): Promise<SpanMap> {
  const spanMap: SpanMap = {}
  for (const doc of docs) {
    const res = await fetch(`${DOC_SERVICE_URL}/documents/${doc.doc_id}/span`, {
      headers: { 'x-sim-tenant-id': tenantId },
    })
    if (!res.ok) { spanMap[doc.doc_id] = []; continue }
    const xml = await res.text()
    spanMap[doc.doc_id] = extractSpans(xml)
  }
  return spanMap
}

function extractSpans(xml: string): Span[] {
  const root = parser.parse(xml)
  const body = root?.ClinicalDocument?.component?.structuredBody
  if (!body) return []
  const components: unknown[] = Array.isArray(body.component) ? body.component : [body.component]
  const spans: Span[] = []
  for (const comp of components) {
    const section = (comp as any)?.section
    if (!section) continue
    const entries: unknown[] = Array.isArray(section.entry) ? section.entry : section.entry ? [section.entry] : []
    for (const entry of entries) {
      const text = extractText(entry)
      if (!text) continue
      spans.push({
        page: 0,
        region: [0, 0, 0, 0],
        text,
        hash: crypto.createHash('sha256').update(text).digest('hex'),
      })
    }
    // also include section-level narrative if present
    const narrative = (section as any)?.text
    if (typeof narrative === 'string' && narrative.trim()) {
      spans.push({ page: 0, region: [0, 0, 0, 0], text: narrative.trim(),
        hash: crypto.createHash('sha256').update(narrative.trim()).digest('hex') })
    }
  }
  return spans
}

function extractText(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (typeof entry !== 'object' || !entry) return ''
  const obs = (entry as any).observation ?? (entry as any).act ?? (entry as any).procedure
  if (!obs) return JSON.stringify(entry)
  const val = obs.value?.['#text'] ?? obs.text?.['#text'] ?? obs.text ?? ''
  const code = obs.code?.['@_displayName'] ?? ''
  return [code, val].filter(Boolean).join(': ')
}

const DOC_SERVICE_URL = process.env['DOCUMENT_SERVICE_URL'] ?? 'http://localhost:4070'
```

**Document service raw bytes** — the document service (`platform/services/document`) already exposes `GET /documents/:docId/span` which returns raw object bytes from MinIO as `application/octet-stream`. `parseCcda` calls this existing endpoint to fetch C-CDA XML — no new document service endpoint needed. The document service also already ships a `tests/fixtures/sample-ccda.xml` fixture, confirming C-CDA is anticipated.

### `RevitalAnalyzeCase` routing

**File:** `modules/revital/pipeline/src/workflows/RevitalAnalyzeCase.ts`

Add optional `document_format: 'pdf' | 'ccda'` to `AnalysisInput`. The workflow branches at the parse step:

```typescript
const spans = docs.length > 0
  ? await (input.document_format === 'ccda' ? parseCcda : parseSegment)(docs, input.tenant_id)
      .catch(() => { status = 'partial'; return {} })
  : {}
```

No other workflow changes.

### `persistAdvisory` — `advisory_type` field

**File:** `modules/revital/pipeline/src/activities/persistAdvisory.ts`

Add `advisory_type: 'pa' | 'claims_attachment'` to the persisted advisory row. Enables the claims service to query only `claims_attachment` advisories via `WHERE advisory_type = 'claims_attachment'`.

Migration on the `revital` schema:
```sql
ALTER TABLE revital.advisory ADD COLUMN advisory_type TEXT NOT NULL DEFAULT 'pa';
CREATE INDEX ON revital.advisory (advisory_type, case_ref);
```

### Claims service — state machine + event + evidence endpoint

**New migration** (`modules/claims/service`):
```sql
ALTER TABLE claims.claim
  ADD COLUMN documentation_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN rfai_doc_id TEXT;
-- valid values: not_requested | requested | received | extraction_complete | rejected
```

**New route** `GET /v1/claims/:caseRef/evidence`:
```typescript
// queries revital.advisory WHERE case_ref = caseId AND advisory_type = 'claims_attachment'
// returns: { claim_id, documentation_status, advisory: AdvisoryRow | null }
```

**`claims.attachment.requested` event** emitted when claim enters `pending_documentation`:
```typescript
await appendEvent(client, {
  topic: 'claims.attachment.requested',
  schemaRef: 'claims.attachment.requested/v1',
  tenantId,
  payload: {
    claim_id: claimId,
    case_ref: caseId,
    loinc_codes: requestedLoincCodes,  // e.g. ['11506-3', '18842-5']
  },
  correlationId: claimId,
})
```

**New Kafka consumers** in claims service:
- `claims.attachment.received` → set `documentation_status = 'received'`, trigger `revitalAnalyzeCase` Temporal workflow with `document_format: 'ccda'`
- `revital.advisory.persisted` (filtered: `advisory_type = 'claims_attachment'`) → set `documentation_status = 'extraction_complete'`

---

## Section 2 — X12 v6020 275/277 Layer (Phase 4B)

### 277-RFAI builder: `RfaiBuilder`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/RfaiBuilder.java`

Builds the X12 v6020 277-RFAI EDI string. Key segments:

```
ISA*00*          *00*          *ZZ*SIMINTERO      *ZZ*{PROVIDER_ID}   *{DATE}*{TIME}*^*00601*{CTL}*0*P*:~
GS*HN*SIMINTERO*{PROVIDER_ID}*{DATE}*{TIME}*{GRP}*X*006020~
ST*277*0001~
BHT*0085*08*{CONTROL_NUMBER}*{DATE}*{TIME}*DG~
NM1*PR*2*SIMINTERO*****PI*{PAYER_ID}~
NM1*QC*1*{PATIENT_LAST}*{PATIENT_FIRST}****MI*{MEMBER_ID}~
NM1*82*2*{PROVIDER_NAME}*****XX*{NPI}~
TRN*1*{CLAIM_ID}*{PAYER_ID}~
STC*{STATUS_CODE}*{DATE}**{AMOUNT}~
REF*1K*{CLAIM_NUMBER}~
PWK*{ATTACHMENT_CONTROL}*AA***AC*{CONTROL_NUMBER}~
{LOI*{LOINC_CODE} per requested doc type}
SE*{SEGMENT_COUNT}*0001~
GE*1*{GRP}~
IEA*1*{CTL}~
```

`{CONTROL_NUMBER}` is a UUID stored in `rfai_correlation.control_number` — this is the correlation key echoed back in the provider's 275 `BGN02` segment.

### 275 X12 parser: `X12v6020AttachmentParser`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/X12v6020AttachmentParser.java`

Parses inbound X12 v6020 275 EDI. Key extractions:
- `BGN02` → `control_number` (join key to `rfai_correlation`)
- `NM1*QC` → patient identity
- `NM1*82` → provider identity
- `BIN` segment → base64-decoded bytes = C-CDA document
- `STC` → claim status context

Returns `ParsedAttachment { controlNumber, patientRef, providerRef, ccdaBytes, signerCert }`.

### FHIR ingest: `AttachDocumentOperation`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/AttachDocumentOperation.java`

New HAPI `@Operation(name="$attach", idempotent=false, type=DocumentReference.class)`. Provider POSTs:

```json
{
  "resourceType": "Bundle",
  "entry": [
    {
      "resource": {
        "resourceType": "DocumentReference",
        "relatesTo": [{ "code": "appends", "target": { "identifier": { "value": "{CONTROL_NUMBER}" } } }],
        "content": [{ "attachment": { "contentType": "application/hl7-v3+xml", "data": "{BASE64_CCDA}" } }]
      }
    }
  ]
}
```

Extracts `controlNumber` from `relatesTo[0].target.identifier.value`, C-CDA bytes from `content[0].attachment.data`, and delegates to `AttachmentProcessor`.

### Correlation table

New Flyway migration `V5__attachment_correlation.sql` in interop:

```sql
CREATE TABLE interop.rfai_correlation (
    rfai_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id       TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    loinc_codes    TEXT[] NOT NULL,
    control_number TEXT NOT NULL UNIQUE,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    fulfilled_at   TIMESTAMPTZ,
    doc_id         TEXT
);
CREATE INDEX ON interop.rfai_correlation (control_number);
CREATE INDEX ON interop.rfai_correlation (claim_id);
```

### `ClaimsAttachmentRequestedConsumer`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/ClaimsAttachmentRequestedConsumer.java`

Kafka consumer on `claims.attachment.requested`. On each message:
1. Build 277-RFAI EDI string via `RfaiBuilder`
2. Submit via `ClearinghouseRfaiClient` (new Java bean, `RestTemplate`-based, same pattern as `NormalizationClient` — interop is Java and cannot use the Node.js `@sim/connector-clearinghouse` package)
3. Insert `rfai_correlation` row

### `ClearinghouseInbound275Consumer`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/ClearinghouseInbound275Consumer.java`

Kafka consumer on `clearinghouse.inbound.275`. Delegates raw EDI string to `X12v6020AttachmentParser`, then to `AttachmentProcessor`.

---

## Section 3 — Electronic Signatures (XMLDSig)

**Library:** `org.apache.santuario:xmlsec:4.0.x` added to interop's `pom.xml`.

### `AttachmentProcessor`

**File:** `services/enstellar-interop/src/main/java/com/simintero/enstellar/interop/attachment/AttachmentProcessor.java`

Unified processor called by both inbound paths:

```java
public AttachmentResult process(String controlNumber, byte[] ccdaBytes, String tenantId) {
    // 1. XMLDSig verification
    Document dom = documentBuilder.parse(new ByteArrayInputStream(ccdaBytes));
    NodeList sigs = dom.getElementsByTagNameNS(XMLSignature.XMLNS, "Signature");
    if (sigs.getLength() == 0) {
        auditRejection(controlNumber, tenantId, "NO_SIGNATURE", null);
        throw new AttachmentSignatureException("NO_SIGNATURE");
    }
    XMLSignature sig = new XMLSignature((Element) sigs.item(0), "");
    X509Certificate cert = sig.getKeyInfo().getX509Certificate();
    try { cert.checkValidity(); } catch (CertificateExpiredException e) {
        auditRejection(controlNumber, tenantId, "CERT_EXPIRED", cert);
        throw new AttachmentSignatureException("CERT_EXPIRED");
    }
    boolean valid = sig.checkSignatureValue(cert);
    if (!valid) {
        auditRejection(controlNumber, tenantId, "SIG_INVALID", cert);
        throw new AttachmentSignatureException("SIG_INVALID");
    }
    auditSuccess(controlNumber, tenantId, cert);

    // 2. Store C-CDA to MinIO
    String minioKey = "attachments/" + controlNumber + ".xml";
    minioStore.storeBytesRaw(tenantId, minioKey, ccdaBytes, "application/hl7-v3+xml");

    // 3. Correlate control_number → claim_id
    RfaiCorrelation corr = correlationRepo.findByControlNumber(controlNumber)
        .orElseThrow(() -> new UnknownAttachmentException(controlNumber));

    // 4. Register with document service → doc_id
    String docId = documentServiceClient.registerAttachment(corr.getClaimId(), minioKey, tenantId);

    // 5. Update correlation row
    correlationRepo.markFulfilled(corr.getRfaiId(), docId);

    // 6. Emit claims.attachment.received
    kafkaTemplate.send("claims.attachment.received", ClaimsAttachmentReceived.builder()
        .claimId(corr.getClaimId()).docId(docId).tenantId(tenantId)
        .certSubject(cert.getSubjectX500Principal().getName()).build());

    return new AttachmentResult(corr.getClaimId(), docId);
}
```

### Audit table

```sql
CREATE TABLE interop.attachment_signature_audit (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_number   TEXT NOT NULL,
    tenant_id        TEXT NOT NULL,
    verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    cert_subject     TEXT,
    cert_sha256      TEXT,
    sig_valid        BOOLEAN NOT NULL,
    rejection_reason TEXT
);
CREATE INDEX ON interop.attachment_signature_audit (control_number);
```

Verification failures are rejected **before** any bytes reach MinIO or the document service. Rejection emits `claims.attachment.rejected` to Kafka with `{ claim_id, reason }` so the claims service sets `documentation_status = 'rejected'`.

**Out of scope for Phase 4:** OCSP/CRL certificate revocation checks — the audit trail records `cert_sha256` for non-repudiation; revocation checking deferred to Phase 6.3.

---

## Kafka Event Contracts

| Topic | Producer | Consumer(s) | Payload |
|---|---|---|---|
| `claims.attachment.requested` | claims-service | interop | `{ claim_id, case_ref, tenant_id, loinc_codes[] }` |
| `clearinghouse.inbound.275` | clearinghouse adapter | interop | raw X12 EDI string |
| `claims.attachment.received` | interop | claims-service | `{ claim_id, doc_id, tenant_id, cert_subject }` |
| `claims.attachment.rejected` | interop | claims-service | `{ claim_id, tenant_id, reason }` |
| `revital.advisory.persisted` | revital-pipeline | claims-service (filtered) | `{ analysis_id, case_ref, advisory_type, status }` |

---

## Files Created / Modified

### Phase 4A

| File | Action |
|---|---|
| `modules/revital/pipeline/src/activities/parseCcda.ts` | Create |
| `modules/revital/pipeline/src/activities/parseCcda.test.ts` | Create |
| `modules/revital/pipeline/src/workflows/RevitalAnalyzeCase.ts` | Modify — add `document_format` routing |
| `modules/revital/pipeline/src/activities/persistAdvisory.ts` | Modify — add `advisory_type` |
| `modules/revital/pipeline/src/activities/index.ts` | Modify — export `parseCcda` |
| `modules/revital/pipeline/migrations/` | Add `advisory_type` column migration |
| `modules/claims/service/src/routes/evidence.ts` | Create — `GET /v1/claims/:id/evidence` |
| `modules/claims/service/src/consumers/attachmentReceived.ts` | Create |
| `modules/claims/service/src/consumers/revitalAdvisory.ts` | Create |
| `modules/claims/service/migrations/` | Add `documentation_status`, `rfai_doc_id` columns |
| `modules/claims/service/src/app.ts` | Modify — mount evidence route, register consumers |

### Phase 4B

| File | Action |
|---|---|
| `services/enstellar-interop/src/main/java/.../attachment/RfaiBuilder.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/ClearinghouseRfaiClient.java` | Create — Java `RestTemplate` bean for 277-RFAI submission |
| `services/enstellar-interop/src/main/java/.../attachment/X12v6020AttachmentParser.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/AttachDocumentOperation.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/AttachmentProcessor.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/ClaimsAttachmentRequestedConsumer.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/ClearinghouseInbound275Consumer.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/AttachmentSignatureException.java` | Create |
| `services/enstellar-interop/src/main/java/.../attachment/UnknownAttachmentException.java` | Create |
| `services/enstellar-interop/src/main/resources/db/migration/V5__attachment_correlation.sql` | Create |
| `services/enstellar-interop/pom.xml` | Modify — add `xmlsec:4.0.x` dependency |
| `integration/connectors/clearinghouse/src/webhooks/inbound275.ts` | Create — HTTP webhook handler that pushes inbound 275 EDI to `clearinghouse.inbound.275` Kafka topic (required for X12 EDI inbound path) |
| `services/enstellar-interop/src/test/java/.../attachment/AttachmentProcessorTest.java` | Create |
| `services/enstellar-interop/src/test/java/.../attachment/X12v6020AttachmentParserTest.java` | Create |
| `services/enstellar-interop/src/test/java/.../attachment/RfaiBuilderTest.java` | Create |

---

## Out of Scope

- OCSP/CRL certificate revocation (Phase 6.3 security hardening)
- Unsolicited attachments — only solicited (277-triggered) attachments in Phase 4
- Claims adjudication / payment decision (platform surfaces evidence; does not adjudicate)
- Portal UI for the claims attachment reviewer workflow (Phase 6.4)
- CMS-0053-F conformance suite / Inferno testing (Phase 5)
- Real model gateway calls in Revital (Phase 2 full depth; Phase 4 uses existing stub-gateway path)

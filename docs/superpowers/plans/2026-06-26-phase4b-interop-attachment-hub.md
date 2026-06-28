# Phase 4B — Interop Attachment Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the interop service as the CMS-0053-F attachment protocol hub — receives 275 clinical documents (FHIR and X12 EDI), verifies XMLDSig, correlates to RFAI, stores in MinIO, notifies the claims service via HTTP callbacks, and emits 277-RFAI requests when the claims service triggers an attachment request.

**Prerequisite:** Plan 4A must be complete. Specifically:
- V034 migration (`claims.claim.documentation_status`) must be applied
- `POST /v1/claims/:caseRef/documentation-request` must exist in the claims service
- `POST /v1/internal/attachment-received` and `/attachment-rejected` must exist in the claims service

**Architecture:** The interop service (Spring Boot, Java) is the natural hub: it already has MinIO (document ingest), HAPI FHIR server, and Kafka consumers (DecisionEventConsumer pattern). Plan 4B adds: (1) an interop-side Flyway V5 migration for `rfai_correlation` + `attachment_signature_audit` tables; (2) `RfaiBuilder` + `ClearinghouseRfaiClient` (WebClient bean, same pattern as `NormalizationClient`) to emit 277-RFAI requests when triggered by a `claims.attachment.requested` Kafka event; (3) `X12v6020AttachmentParser` to parse the inbound X12 275 EDI segment stream; (4) `AttachmentProcessor` (core service bean) that verifies XMLDSig with `xmlsec:4.0.x`, writes to MinIO, records audit, correlates to RFAI, then calls the claims service via `ClaimsServiceClient` (WebClient); (5) `AttachDocumentOperation` (HAPI `IBaseResourceProvider` operation) for FHIR `DocumentReference/$attach`; (6) two Kafka consumers (`ClaimsAttachmentRequestedConsumer` + `ClearinghouseInbound275Consumer`); (7) a clearinghouse inbound webhook handler (Node.js, in `integration/connectors/clearinghouse/`) that publishes arriving 275 EDI messages to `clearinghouse.inbound.275` Kafka topic.

**Tech Stack:** Java 21, Spring Boot, Spring WebFlux (`WebClient`), HAPI FHIR R4, Apache Santuario (`xmlsec:4.0.x`), Flyway (interop V5), Kafka (`@KafkaListener`), MinIO, TypeScript/Node.js (clearinghouse webhook), Vitest (Node.js tests), JUnit 5 / Mockito (Java tests)

## Global Constraints

- Java package root: `io.simintero.interop` (matches existing classes like `io.simintero.interop.pas.NormalizationClient`)
- Interop Flyway migration path: `services/enstellar-interop/src/main/resources/db/migration/V5__attachment_correlation.sql`
- Clearinghouse connector: `integration/connectors/clearinghouse/src/`
- `ClearinghouseRfaiClient` must use Spring `WebClient` with `.block(Duration.ofSeconds(30))` — NOT `WebFlux` reactive chains — matching `NormalizationClient` pattern
- `ClaimsServiceClient` must follow the same WebClient pattern
- XMLDSig: use `org.apache.santuario:xmlsec:4.0.x`; call `XMLSignatureFactory.getInstance("DOM")` + `DOMValidateContext`; verify `enveloped-signature` transform; write cert subject + SHA256 fingerprint to `attachment_signature_audit`; OCSP/CRL deferred to Phase 6.3
- `claims.attachment.requested` Kafka topic is the trigger: consumer reads `{ claim_id, case_ref, loinc_codes }` from the outbox-emitted event and calls `ClearinghouseRfaiClient` to send 277-RFAI
- `clearinghouse.inbound.275` Kafka topic: Node.js webhook publishes raw X12 EDI string; Java consumer reads and processes
- MinIO bucket for attachments: `documents` (same bucket as existing document ingest)
- `object_key` format for attachments: `attachments/{tenantId}/{rfai_id}/{filename}` 
- `CLAIMS_SERVICE_URL` env var for the claims service base URL (default `http://localhost:3040`)
- `CLEARINGHOUSE_SERVICE_URL` env var for the clearinghouse adapter (default `http://localhost:3060`)
- Kafka consumer error handling: `FixedBackOff(1000L, 3)` + `DeadLetterPublishingRecoverer` (matching existing `KafkaConsumerConfig.java`)
- Commit every task separately with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- All interop Java source lives under `services/enstellar-interop/src/main/java/io/simintero/interop/`
- Test Java classes under `services/enstellar-interop/src/test/java/io/simintero/interop/`

---

### Task 1: Interop V5 Flyway migration

**Files:**
- Create: `services/enstellar-interop/src/main/resources/db/migration/V5__attachment_correlation.sql`

**Interfaces:**
- Produces: `interop.rfai_correlation` table + `interop.attachment_signature_audit` table; these are read by Tasks 4 and 6

- [ ] **Step 1: Create the migration file**

Create `services/enstellar-interop/src/main/resources/db/migration/V5__attachment_correlation.sql`:
```sql
-- V5: CMS-0053-F attachment correlation tables

CREATE TABLE IF NOT EXISTS interop.rfai_correlation (
    rfai_id         TEXT        PRIMARY KEY,
    claim_id        TEXT        NOT NULL,
    tenant_id       TEXT        NOT NULL,
    case_ref        TEXT        NOT NULL,
    loinc_codes     TEXT[]      NOT NULL DEFAULT '{}',
    control_number  TEXT,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at    TIMESTAMPTZ,
    doc_id          TEXT
);

CREATE INDEX rfai_correlation_claim_idx   ON interop.rfai_correlation (claim_id, tenant_id);
CREATE INDEX rfai_correlation_control_idx ON interop.rfai_correlation (control_number) WHERE control_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS interop.attachment_signature_audit (
    audit_id        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rfai_id         TEXT        REFERENCES interop.rfai_correlation(rfai_id),
    doc_id          TEXT,
    tenant_id       TEXT        NOT NULL,
    cert_subject    TEXT,
    cert_sha256     TEXT,
    sig_valid       BOOLEAN     NOT NULL,
    rejection_reason TEXT,
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Verify Flyway picks it up at startup**

Build just the interop service to catch parse errors:
```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew compileJava --no-daemon 2>&1 | tail -5
```
Expected: `BUILD SUCCESSFUL`. Flyway will apply V5 at runtime on next startup.

- [ ] **Step 3: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/resources/db/migration/V5__attachment_correlation.sql
git commit -m "feat(interop): add V5 Flyway migration for rfai_correlation and attachment_signature_audit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `RfaiBuilder` + `ClearinghouseRfaiClient`

**Files:**
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/RfaiBuilder.java`
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseRfaiClient.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/RfaiBuilderTest.java`

**Interfaces:**
- Consumes: nothing external to this task
- Produces:
  - `RfaiBuilder.build(rfaiId, claimId, caseRef, loincCodes): String` — returns X12 v6020 277-RFAI EDI string
  - `ClearinghouseRfaiClient.sendRfai(rfaiId, claimId, caseRef, loincCodes[], tenantId): void` — calls `POST /rfai` on the clearinghouse adapter

- [ ] **Step 1: Write the failing unit test**

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/RfaiBuilderTest.java`:
```java
package io.simintero.interop.attachments;

import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class RfaiBuilderTest {

    @Test
    void buildContainsBerSegments() {
        String edi = RfaiBuilder.build("RFAI-001", "CLM-001", "case-001",
                List.of("11506-3", "18842-5"));
        assertThat(edi).startsWith("ISA*");
        assertThat(edi).contains("ST*277*");
        assertThat(edi).contains("TRN*1*RFAI-001");
        assertThat(edi).contains("PWK*");
        assertThat(edi).contains("11506-3");
        assertThat(edi).contains("18842-5");
        assertThat(edi).contains("IEA*");
    }

    @Test
    void buildMultipleLoincCodesProducesMultiplePwk() {
        String edi = RfaiBuilder.build("RFAI-002", "CLM-002", "case-002",
                List.of("11506-3", "47519-4", "60591-5"));
        long pwkCount = edi.lines().filter(l -> l.startsWith("PWK*")).count();
        assertThat(pwkCount).isEqualTo(3);
    }

    @Test
    void controlNumberIsTruncatedTo9Chars() {
        String rfaiId = "RFAI-VERY-LONG-ID-12345";
        String edi = RfaiBuilder.build(rfaiId, "CLM", "case", List.of("11506-3"));
        // Control numbers in ISA are 9 characters
        String[] isaFields = edi.split("\\*");
        assertThat(isaFields[13].trim()).hasSize(9);
    }
}
```

Run: `cd services/enstellar-interop && ./gradlew test --tests "io.simintero.interop.attachments.RfaiBuilderTest" --no-daemon 2>&1 | tail -10`
Expected: FAIL with "cannot find symbol RfaiBuilder"

- [ ] **Step 2: Implement `RfaiBuilder.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/RfaiBuilder.java`:
```java
package io.simintero.interop.attachments;

import java.util.List;

/**
 * Builds a minimal X12 v6020 277-RFAI (request for additional information) EDI string.
 * Each LOINC code becomes one PWK (paperwork) segment identifying the document type requested.
 */
public final class RfaiBuilder {

    private RfaiBuilder() {}

    public static String build(String rfaiId, String claimId, String caseRef,
                               List<String> loincCodes) {
        // X12 control number must be exactly 9 chars (pad/truncate rfaiId)
        String ctrl = padRight(rfaiId.replaceAll("[^A-Z0-9a-z]", "").toUpperCase(), 9).substring(0, 9);
        StringBuilder sb = new StringBuilder();

        // ISA header
        sb.append("ISA*00*          *00*          *ZZ*SIMINTERO      *ZZ*CLEARINGHSE   *")
          .append("260101*1200*^*00601*").append(ctrl).append("*0*P*:\n");
        // Functional group header
        sb.append("GS*HN*SIMINTERO*CLEARINGHSE*20260101*1200*1*X*006020\n");
        // Transaction set header (277 RFAI)
        sb.append("ST*277*0001*005010X212\n");
        sb.append("BHT*0085*08*").append(ctrl).append("*20260101*1200*TH\n");

        // Payer loop (NM1*PR - payer)
        sb.append("HL*1**20*1\n");
        sb.append("NM1*PR*2*SIMINTERO HEALTH*****PI*SIM001\n");

        // Provider loop (NM1*1P - provider)
        sb.append("HL*2*1*21*1\n");
        sb.append("NM1*1P*2*PROVIDER NETWORK*****XX*1234567890\n");

        // Subscriber loop
        sb.append("HL*3*2*22*0\n");
        sb.append("TRN*1*").append(rfaiId).append("*1SIMINTERO\n");
        sb.append("NM1*IL*1************\n");
        sb.append("REF*EJ*").append(claimId).append("\n");
        sb.append("REF*D9*").append(caseRef).append("\n");

        // One PWK segment per LOINC code
        int seq = 1;
        for (String loinc : loincCodes) {
            sb.append("PWK*").append(String.format("%02d", seq)).append("*EL*").append(loinc).append("\n");
            seq++;
        }

        // Transaction set trailer
        sb.append("SE*").append(countSegments(sb.toString(), "ST")).append("*0001\n");
        // Functional group trailer
        sb.append("GE*1*1\n");
        // ISA trailer
        sb.append("IEA*1*").append(ctrl).append("\n");

        return sb.toString();
    }

    private static String padRight(String s, int len) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < len) sb.append('0');
        return sb.toString();
    }

    private static int countSegments(String edi, String fromTag) {
        // Count lines starting from ST* (inclusive) to SE (exclusive)
        boolean counting = false;
        int count = 0;
        for (String line : edi.split("\n")) {
            if (line.startsWith(fromTag + "*")) counting = true;
            if (counting && !line.isBlank()) count++;
        }
        return count;
    }
}
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew test --tests "io.simintero.interop.attachments.RfaiBuilderTest" --no-daemon 2>&1 | tail -15
```
Expected: 3 tests PASS.

- [ ] **Step 4: Implement `ClearinghouseRfaiClient.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseRfaiClient.java`:
```java
package io.simintero.interop.attachments;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Component
public class ClearinghouseRfaiClient {

    private static final Logger log = LoggerFactory.getLogger(ClearinghouseRfaiClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;

    public ClearinghouseRfaiClient(
            @Value("${clearinghouse.service.url:http://localhost:3060}") String baseUrl,
            WebClient.Builder builder) {
        this.webClient = builder.baseUrl(baseUrl).build();
    }

    public void sendRfai(String rfaiId, String claimId, String caseRef,
                         List<String> loincCodes, String tenantId) {
        String ediBody = RfaiBuilder.build(rfaiId, claimId, caseRef, loincCodes);
        try {
            webClient.post()
                .uri("/rfai")
                .header("Content-Type", "application/x12")
                .header("X-Sim-Tenant-Id", tenantId)
                .bodyValue(ediBody)
                .retrieve()
                .toBodilessEntity()
                .block(TIMEOUT);
            log.info("[rfai] sent rfaiId={} claimId={} loincCount={}", rfaiId, claimId, loincCodes.size());
        } catch (Exception ex) {
            log.error("[rfai] failed rfaiId={} error={}", rfaiId, ex.getMessage());
            throw new RfaiSendException("RFAI send failed for " + rfaiId, ex);
        }
    }
}
```

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/RfaiSendException.java`:
```java
package io.simintero.interop.attachments;

public class RfaiSendException extends RuntimeException {
    public RfaiSendException(String message, Throwable cause) { super(message, cause); }
}
```

- [ ] **Step 5: Build to verify compilation**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew compileJava --no-daemon 2>&1 | tail -5
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/java/io/simintero/interop/attachments/RfaiBuilder.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseRfaiClient.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/RfaiSendException.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/RfaiBuilderTest.java
git commit -m "feat(interop): add RfaiBuilder X12 277-RFAI builder and ClearinghouseRfaiClient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `X12v6020AttachmentParser`

**Files:**
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/X12v6020AttachmentParser.java`
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ParsedAttachment275.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/X12v6020AttachmentParserTest.java`

**Interfaces:**
- Consumes: raw X12 EDI string from `clearinghouse.inbound.275` Kafka topic
- Produces:
  - `ParsedAttachment275` record: `controlNumber, claimId, tenantId, ccdaBase64, loincCode`
  - `X12v6020AttachmentParser.parse(String ediString): ParsedAttachment275`

- [ ] **Step 1: Create the `ParsedAttachment275` record**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ParsedAttachment275.java`:
```java
package io.simintero.interop.attachments;

public record ParsedAttachment275(
    String controlNumber,   // from PWK segment, correlates to rfai_correlation.control_number
    String claimId,         // from REF*EJ
    String tenantId,        // from custom SIM-TENANT header segment or X12 metadata
    String ccdaBase64,      // BIN segment content (base64-encoded C-CDA XML)
    String loincCode        // from PWK LOINC code field
) {}
```

- [ ] **Step 2: Write the failing test**

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/X12v6020AttachmentParserTest.java`:
```java
package io.simintero.interop.attachments;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class X12v6020AttachmentParserTest {

    private static final String SAMPLE_EDI = """
            ISA*00*          *00*          *ZZ*PROVIDER        *ZZ*SIMINTERO       *260101*1200*^*00601*CTRL00001*0*P*:
            GS*AR*PROVIDER*SIMINTERO*20260101*1200*1*X*006020
            ST*275*0001*005010X210
            BGN*11*CTRL00001*20260101*1200*UT*ORIGINAL**2
            NM1*1P*2*PROVIDER NETWORK*****XX*1234567890
            NM1*PR*2*SIMINTERO HEALTH*****PI*SIM001
            TRN*1*RFAI-001*1SIMINTERO
            REF*EJ*CLM-TEST-001
            REF*SIM*tenant-dev
            PWK*01*EL*11506-3
            BIN*247*PD94bWwgdmVyc2lvbj0iMS4wIj8+PENsaW5pY2FsRG9jdW1lbnQ+PC9DbGluaWNhbERvY3VtZW50Pg==
            SE*12*0001
            GE*1*1
            IEA*1*CTRL00001
            """;

    @Test
    void parsesControlNumber() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.controlNumber()).isEqualTo("RFAI-001");
    }

    @Test
    void parsesClaimId() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.claimId()).isEqualTo("CLM-TEST-001");
    }

    @Test
    void parsesTenantId() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.tenantId()).isEqualTo("tenant-dev");
    }

    @Test
    void parsesLoincCode() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.loincCode()).isEqualTo("11506-3");
    }

    @Test
    void parsesCcdaBase64() {
        ParsedAttachment275 result = X12v6020AttachmentParser.parse(SAMPLE_EDI);
        assertThat(result.ccdaBase64()).isNotBlank();
        assertThat(result.ccdaBase64()).startsWith("PD94"); // base64 for <?xml
    }

    @Test
    void throwsOnMalformedEdi() {
        assertThatThrownBy(() -> X12v6020AttachmentParser.parse("NOT EDI"))
            .isInstanceOf(AttachmentParseException.class);
    }
}
```

Run: `./gradlew test --tests "io.simintero.interop.attachments.X12v6020AttachmentParserTest" --no-daemon 2>&1 | tail -10`
Expected: FAIL with "cannot find symbol"

- [ ] **Step 3: Create exception class**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachmentParseException.java`:
```java
package io.simintero.interop.attachments;

public class AttachmentParseException extends RuntimeException {
    public AttachmentParseException(String message) { super(message); }
    public AttachmentParseException(String message, Throwable cause) { super(message, cause); }
}
```

- [ ] **Step 4: Implement `X12v6020AttachmentParser.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/X12v6020AttachmentParser.java`:
```java
package io.simintero.interop.attachments;

import java.util.Arrays;
import java.util.List;

/**
 * Parses an X12 v6020 275 (additional information) EDI string.
 * Extracts the control number (TRN*1), claim ID (REF*EJ), tenant (REF*SIM),
 * LOINC code (PWK), and C-CDA payload (BIN).
 */
public final class X12v6020AttachmentParser {

    private X12v6020AttachmentParser() {}

    public static ParsedAttachment275 parse(String edi) {
        if (edi == null || !edi.contains("ST*275")) {
            throw new AttachmentParseException("Not a valid X12 275 transaction");
        }

        List<String[]> segments = Arrays.stream(edi.split("[\\r\\n]+"))
            .map(String::trim)
            .filter(l -> !l.isBlank())
            .map(l -> l.split("\\*"))
            .toList();

        String controlNumber = null;
        String claimId = null;
        String tenantId = null;
        String loincCode = null;
        String ccdaBase64 = null;

        for (String[] seg : segments) {
            String tag = seg[0];
            switch (tag) {
                case "TRN" -> {
                    if (seg.length > 2) controlNumber = seg[2].trim();
                }
                case "REF" -> {
                    if (seg.length > 2) {
                        if ("EJ".equals(seg[1].trim())) claimId = seg[2].trim();
                        if ("SIM".equals(seg[1].trim())) tenantId = seg[2].trim();
                    }
                }
                case "PWK" -> {
                    if (seg.length > 3) loincCode = seg[3].trim();
                }
                case "BIN" -> {
                    // BIN*<length>*<base64data>
                    if (seg.length > 2) ccdaBase64 = seg[2].trim();
                }
                default -> {} // ignore other segments
            }
        }

        if (controlNumber == null || claimId == null || ccdaBase64 == null) {
            throw new AttachmentParseException(
                "Missing required segments: controlNumber=" + controlNumber
                + " claimId=" + claimId + " ccdaBase64=" + (ccdaBase64 != null ? "present" : "null"));
        }

        return new ParsedAttachment275(controlNumber, claimId,
                tenantId != null ? tenantId : "unknown", ccdaBase64, loincCode);
    }
}
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew test --tests "io.simintero.interop.attachments.X12v6020AttachmentParserTest" --no-daemon 2>&1 | tail -15
```
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/java/io/simintero/interop/attachments/X12v6020AttachmentParser.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ParsedAttachment275.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachmentParseException.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/X12v6020AttachmentParserTest.java
git commit -m "feat(interop): add X12 v6020 275 attachment parser

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `AttachmentProcessor` + `ClaimsServiceClient` + XMLDSig + pom.xml

**Files:**
- Modify: `services/enstellar-interop/build.gradle` (add `xmlsec:4.0.x` dependency)
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsServiceClient.java`
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachmentProcessor.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachmentProcessorTest.java`

**Interfaces:**
- Consumes: `ParsedAttachment275` from Task 3; `rfai_correlation` table from Task 1; MinIO (existing `DocumentStorageService` or raw S3Client — check existing usage pattern in interop)
- Produces:
  - `AttachmentProcessor.process(ParsedAttachment275): String` — returns `docId`; writes to MinIO, updates `rfai_correlation`, writes `attachment_signature_audit`, calls `ClaimsServiceClient`
  - `ClaimsServiceClient.notifyReceived(claimId, caseRef, docId, tenantId, loincCodes[]): void`
  - `ClaimsServiceClient.notifyRejected(claimId, tenantId, reason): void`

> **Important:** Before implementing, read `services/enstellar-interop/src/main/java/io/simintero/interop/` to find the existing MinIO / S3Client bean and its usage pattern. Use the same bean — do NOT add a second MinIO client. The object key pattern for attachments is `attachments/{tenantId}/{rfaiId}/{uuid}.xml`.

- [ ] **Step 1: Add `xmlsec` dependency to `build.gradle`**

In `services/enstellar-interop/build.gradle`, find the `dependencies { ... }` block and add:
```groovy
implementation 'org.apache.santuario:xmlsec:4.0.3'
```

Verify:
```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew dependencies --configuration compileClasspath --no-daemon 2>&1 | grep -i santuario
```
Expected: `org.apache.santuario:xmlsec:4.0.3`

- [ ] **Step 2: Implement `ClaimsServiceClient.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsServiceClient.java`:
```java
package io.simintero.interop.attachments;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

@Component
public class ClaimsServiceClient {

    private static final Logger log = LoggerFactory.getLogger(ClaimsServiceClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;

    public ClaimsServiceClient(
            @Value("${claims.service.url:http://localhost:3040}") String baseUrl,
            WebClient.Builder builder) {
        this.webClient = builder.baseUrl(baseUrl).build();
    }

    public void notifyReceived(String claimId, String caseRef, String docId,
                               String tenantId, List<String> loincCodes) {
        try {
            webClient.post()
                .uri("/v1/internal/attachment-received")
                .header("Content-Type", "application/json")
                .bodyValue(Map.of(
                    "claim_id", claimId,
                    "case_ref", caseRef,
                    "doc_id", docId,
                    "tenant_id", tenantId,
                    "loinc_codes", loincCodes
                ))
                .retrieve()
                .toBodilessEntity()
                .block(TIMEOUT);
            log.info("[claims-client] attachment-received claimId={} docId={}", claimId, docId);
        } catch (Exception ex) {
            log.error("[claims-client] notify-received failed claimId={} error={}", claimId, ex.getMessage());
            throw new RuntimeException("Claims notify-received failed", ex);
        }
    }

    public void notifyRejected(String claimId, String tenantId, String reason) {
        try {
            webClient.post()
                .uri("/v1/internal/attachment-rejected")
                .header("Content-Type", "application/json")
                .bodyValue(Map.of("claim_id", claimId, "tenant_id", tenantId, "reason", reason))
                .retrieve()
                .toBodilessEntity()
                .block(TIMEOUT);
            log.info("[claims-client] attachment-rejected claimId={} reason={}", claimId, reason);
        } catch (Exception ex) {
            log.error("[claims-client] notify-rejected failed claimId={} error={}", claimId, ex.getMessage());
            throw new RuntimeException("Claims notify-rejected failed", ex);
        }
    }
}
```

- [ ] **Step 3: Write the failing test for `AttachmentProcessor`**

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachmentProcessorTest.java`:
```java
package io.simintero.interop.attachments;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.core.sync.RequestBody;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AttachmentProcessorTest {

    @Mock S3Client s3Client;
    @Mock JdbcTemplate jdbc;
    @Mock ClaimsServiceClient claimsClient;

    AttachmentProcessor processor;

    @org.junit.jupiter.api.BeforeEach
    void setUp() {
        processor = new AttachmentProcessor(s3Client, jdbc, claimsClient, "documents");
    }

    private static final String PLAIN_CCDA_B64 =
        "PD94bWwgdmVyc2lvbj0iMS4wIj8+PENsaW5pY2FsRG9jdW1lbnQ+PGNvbXBvbmVudD48L2NvbXBvbmVudD48L0NsaW5pY2FsRG9jdW1lbnQ+";

    private ParsedAttachment275 sampleAttachment() {
        return new ParsedAttachment275("RFAI-001", "CLM-001", "tenant-dev", PLAIN_CCDA_B64, "11506-3");
    }

    @Test
    void returnsDocId() {
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
            .thenReturn(PutObjectResponse.builder().build());
        when(jdbc.queryForMap(argThat(sql -> sql.contains("rfai_correlation") && sql.contains("RFAI-001"))))
            .thenReturn(Map.of("claim_id", "CLM-001", "case_ref", "case-001",
                    "loinc_codes", new String[]{"11506-3"}));

        String docId = processor.process(sampleAttachment());
        assertThat(docId).isNotBlank();
    }

    @Test
    void storesDocumentInS3() {
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
            .thenReturn(PutObjectResponse.builder().build());
        when(jdbc.queryForMap(any())).thenReturn(Map.of("claim_id", "CLM-001", "case_ref", "case-001",
                "loinc_codes", new String[]{"11506-3"}));

        processor.process(sampleAttachment());

        verify(s3Client).putObject(
            argThat((PutObjectRequest r) -> r.key().startsWith("attachments/tenant-dev/RFAI-001/")),
            any(RequestBody.class)
        );
    }

    @Test
    void writesSignatureAuditRecord() {
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
            .thenReturn(PutObjectResponse.builder().build());
        when(jdbc.queryForMap(any())).thenReturn(Map.of("claim_id", "CLM-001", "case_ref", "case-001",
                "loinc_codes", new String[]{"11506-3"}));

        processor.process(sampleAttachment());

        verify(jdbc).update(
            argThat((String sql) -> sql.contains("attachment_signature_audit")),
            any(Object[].class)
        );
    }

    @Test
    void notifiesClaimsServiceOnSuccess() {
        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
            .thenReturn(PutObjectResponse.builder().build());
        when(jdbc.queryForMap(any())).thenReturn(Map.of("claim_id", "CLM-001", "case_ref", "case-001",
                "loinc_codes", new String[]{"11506-3"}));

        processor.process(sampleAttachment());

        verify(claimsClient).notifyReceived(
            eq("CLM-001"), eq("case-001"), any(String.class), eq("tenant-dev"), anyList()
        );
    }

    @Test
    void notifiesClaimsRejectedOnSigFailure() {
        // Use a C-CDA that has an invalid XMLDSig element to trigger rejection
        String badCcda = "PENsaW5pY2FsRG9jdW1lbnQ+PFNpZ25hdHVyZSB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC8wOS94bWxkc2lnIyI+PFNpZ25lZEluZm8+PC9TaWduZWRJbmZvPjwvU2lnbmF0dXJlPjwvQ2xpbmljYWxEb2N1bWVudD4=";
        ParsedAttachment275 attachment = new ParsedAttachment275(
            "RFAI-002", "CLM-002", "tenant-dev", badCcda, "11506-3"
        );
        when(jdbc.queryForMap(any())).thenReturn(Map.of("claim_id", "CLM-002", "case_ref", "case-002",
                "loinc_codes", new String[]{"11506-3"}));

        processor.process(attachment);

        verify(claimsClient).notifyRejected(eq("CLM-002"), eq("tenant-dev"), any(String.class));
        // Should NOT notify received
        verify(claimsClient, never()).notifyReceived(any(), any(), any(), any(), any());
    }
}
```

Run: `./gradlew test --tests "io.simintero.interop.attachments.AttachmentProcessorTest" --no-daemon 2>&1 | tail -10`
Expected: FAIL with "cannot find symbol AttachmentProcessor"

- [ ] **Step 4: Implement `AttachmentProcessor.java`**

> **Read first:** Check what bean holds the S3/MinIO client in interop. Look at `services/enstellar-interop/src/main/java/io/simintero/interop/config/` and `services/enstellar-interop/src/main/java/io/simintero/interop/documents/` for how MinIO is accessed. Use the existing `S3Client` bean. The bucket name is in a `@Value("${storage.bucket:documents}")` config.

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachmentProcessor.java`:
```java
package io.simintero.interop.attachments;

import org.apache.xml.security.Init;
import org.apache.xml.security.keys.KeyInfo;
import org.apache.xml.security.signature.XMLSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class AttachmentProcessor {

    static {
        // Apache Santuario requires explicit initialization
        Init.init();
    }

    private static final Logger log = LoggerFactory.getLogger(AttachmentProcessor.class);

    private final S3Client s3;
    private final JdbcTemplate jdbc;
    private final ClaimsServiceClient claimsClient;
    private final String bucket;

    public AttachmentProcessor(
            S3Client s3,
            JdbcTemplate jdbc,
            ClaimsServiceClient claimsClient,
            @Value("${storage.bucket:documents}") String bucket) {
        this.s3 = s3;
        this.jdbc = jdbc;
        this.claimsClient = claimsClient;
        this.bucket = bucket;
    }

    /**
     * Process an inbound C-CDA attachment: verify XMLDSig, store in MinIO,
     * record audit, correlate to RFAI, notify claims service.
     *
     * @return docId stored in MinIO (or null if sig-rejected)
     */
    public String process(ParsedAttachment275 attachment) {
        byte[] ccdaBytes;
        try {
            ccdaBytes = Base64.getDecoder().decode(attachment.ccdaBase64());
        } catch (Exception ex) {
            log.warn("[attachment-processor] base64 decode failed rfaiId={}", attachment.controlNumber());
            rejectAndAudit(attachment, null, false, "BASE64_DECODE_FAILED");
            return null;
        }

        // Verify XMLDSig if present
        SigVerificationResult sigResult = verifyXmlDsig(ccdaBytes);
        if (!sigResult.valid()) {
            rejectAndAudit(attachment, sigResult, false, sigResult.rejectionReason());
            return null;
        }

        // Store in MinIO
        String docId = UUID.randomUUID().toString();
        String objectKey = "attachments/" + attachment.tenantId() + "/"
            + attachment.controlNumber() + "/" + docId + ".xml";
        s3.putObject(
            PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType("application/xml")
                .build(),
            RequestBody.fromBytes(ccdaBytes)
        );

        // Update rfai_correlation
        jdbc.update(
            "UPDATE interop.rfai_correlation SET fulfilled_at = NOW(), doc_id = ? WHERE rfai_id = ?",
            docId, attachment.controlNumber()
        );

        // Write audit record
        writeAudit(attachment.controlNumber(), docId, attachment.tenantId(), sigResult, true, null);

        // Look up claim/case info from rfai_correlation
        Map<String, Object> correlation;
        try {
            correlation = jdbc.queryForMap(
                "SELECT claim_id, case_ref, loinc_codes FROM interop.rfai_correlation WHERE rfai_id = ?",
                attachment.controlNumber()
            );
        } catch (Exception ex) {
            log.error("[attachment-processor] rfai_correlation lookup failed rfaiId={}", attachment.controlNumber());
            return docId;
        }

        String claimId = (String) correlation.get("claim_id");
        String caseRef = (String) correlation.get("case_ref");
        String[] loincArray = (String[]) correlation.get("loinc_codes");
        List<String> loincCodes = loincArray != null ? Arrays.asList(loincArray) : List.of();

        claimsClient.notifyReceived(claimId, caseRef, docId, attachment.tenantId(), loincCodes);
        return docId;
    }

    private void rejectAndAudit(ParsedAttachment275 attachment, SigVerificationResult sig,
                                 boolean sigValid, String reason) {
        writeAudit(attachment.controlNumber(), null, attachment.tenantId(), sig, sigValid, reason);
        try {
            Map<String, Object> correlation = jdbc.queryForMap(
                "SELECT claim_id FROM interop.rfai_correlation WHERE rfai_id = ?",
                attachment.controlNumber()
            );
            String claimId = (String) correlation.get("claim_id");
            claimsClient.notifyRejected(claimId, attachment.tenantId(), reason);
        } catch (Exception ex) {
            log.error("[attachment-processor] rejection notify failed rfaiId={}", attachment.controlNumber());
        }
    }

    private void writeAudit(String rfaiId, String docId, String tenantId,
                             SigVerificationResult sig, boolean valid, String reason) {
        String certSubject = sig != null ? sig.certSubject() : null;
        String certSha256 = sig != null ? sig.certSha256() : null;
        jdbc.update(
            "INSERT INTO interop.attachment_signature_audit "
                + "(rfai_id, doc_id, tenant_id, cert_subject, cert_sha256, sig_valid, rejection_reason) "
                + "VALUES (?,?,?,?,?,?,?)",
            rfaiId, docId, tenantId, certSubject, certSha256, valid, reason
        );
    }

    private SigVerificationResult verifyXmlDsig(byte[] ccdaBytes) {
        // Parse to DOM
        Document doc;
        try {
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setNamespaceAware(true);
            DocumentBuilder db = dbf.newDocumentBuilder();
            doc = db.parse(new ByteArrayInputStream(ccdaBytes));
        } catch (Exception ex) {
            return SigVerificationResult.invalid("XML_PARSE_ERROR");
        }

        // Check if Signature element exists; if not, pass-through (unsigned C-CDA is allowed)
        var sigElements = doc.getElementsByTagNameNS(
            "http://www.w3.org/2000/09/xmldsig#", "Signature");
        if (sigElements.getLength() == 0) {
            return SigVerificationResult.unsigned();
        }

        // Verify using Apache Santuario
        try {
            XMLSignature sig = new XMLSignature(
                (org.w3c.dom.Element) sigElements.item(0),
                doc.getDocumentURI()
            );
            KeyInfo keyInfo = sig.getKeyInfo();
            if (keyInfo == null) return SigVerificationResult.invalid("NO_KEY_INFO");

            X509Certificate cert = keyInfo.getX509Certificate();
            if (cert == null) return SigVerificationResult.invalid("NO_X509_CERT");

            boolean valid = sig.checkSignatureValue(cert.getPublicKey());
            if (!valid) return SigVerificationResult.invalid("SIG_INVALID");

            String sha256 = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())
            );
            return SigVerificationResult.valid(cert.getSubjectX500Principal().getName(), sha256);
        } catch (Exception ex) {
            log.warn("[attachment-processor] xmldsig verification exception: {}", ex.getMessage());
            return SigVerificationResult.invalid("SIG_VERIFICATION_ERROR");
        }
    }

    /** Value object for XMLDSig verification result */
    public record SigVerificationResult(
        boolean valid,
        String certSubject,
        String certSha256,
        String rejectionReason
    ) {
        static SigVerificationResult valid(String subject, String sha256) {
            return new SigVerificationResult(true, subject, sha256, null);
        }
        static SigVerificationResult unsigned() {
            return new SigVerificationResult(true, null, null, null);
        }
        static SigVerificationResult invalid(String reason) {
            return new SigVerificationResult(false, null, null, reason);
        }
    }
}
```

- [ ] **Step 5: Run the tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew test --tests "io.simintero.interop.attachments.AttachmentProcessorTest" --no-daemon 2>&1 | tail -15
```
Expected: 5 tests PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
./gradlew test --no-daemon 2>&1 | tail -10
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachmentProcessor.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsServiceClient.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachmentProcessorTest.java \
        services/enstellar-interop/build.gradle
git commit -m "feat(interop): add AttachmentProcessor with XMLDSig, MinIO storage, and claims notification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `AttachDocumentOperation` (FHIR `DocumentReference/$attach`)

**Files:**
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachDocumentOperation.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachDocumentOperationTest.java`

**Interfaces:**
- Consumes: `AttachmentProcessor.process(ParsedAttachment275)` from Task 4
- Produces: HAPI FHIR `@Operation(name="$attach", idempotent=false)` on `DocumentReference` — accepts a `DocumentReference` resource containing a base64 attachment, calls `AttachmentProcessor.process`, returns `OperationOutcome`

> **Read first:** Look at existing HAPI FHIR provider classes in `services/enstellar-interop/src/main/java/io/simintero/interop/` to understand how `IResourceProvider` / `@Operation` is registered. Verify which HAPI version is in use from `build.gradle` and match the exact import packages.

- [ ] **Step 1: Write the failing test**

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachDocumentOperationTest.java`:
```java
package io.simintero.interop.attachments;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.DocumentReference;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AttachDocumentOperationTest {

    @Mock AttachmentProcessor processor;
    @InjectMocks AttachDocumentOperation operation;

    private static final String CCDA_B64 = Base64.getEncoder().encodeToString(
        "<?xml version='1.0'?><ClinicalDocument/>".getBytes()
    );

    @Test
    void delegatesToProcessorAndReturnsOutcome() {
        when(processor.process(any())).thenReturn("doc-id-001");

        DocumentReference dr = new DocumentReference();
        DocumentReference.DocumentReferenceContentComponent content =
            new DocumentReference.DocumentReferenceContentComponent();
        Attachment attachment = new Attachment();
        attachment.setContentType("application/xml");
        attachment.setDataElement(new org.hl7.fhir.r4.model.Base64BinaryType(CCDA_B64));
        content.setAttachment(attachment);
        dr.setContent(List.of(content));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/rfai-control-number")
            .setValue(new org.hl7.fhir.r4.model.StringType("RFAI-001"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/claim-id")
            .setValue(new org.hl7.fhir.r4.model.StringType("CLM-001"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/tenant-id")
            .setValue(new org.hl7.fhir.r4.model.StringType("tenant-dev"));
        dr.addExtension()
            .setUrl("http://simintero.io/fhir/StructureDefinition/loinc-code")
            .setValue(new org.hl7.fhir.r4.model.StringType("11506-3"));

        OperationOutcome result = operation.attach(dr, mock(RequestDetails.class));
        assertThat(result).isNotNull();
        assertThat(result.getIssue()).hasSize(1);
        assertThat(result.getIssueFirstRep().getSeverity())
            .isEqualTo(OperationOutcome.IssueSeverity.INFORMATION);
        verify(processor).process(any(ParsedAttachment275.class));
    }

    @Test
    void returnsErrorOutcomeWhenNoAttachment() {
        DocumentReference dr = new DocumentReference(); // no content
        OperationOutcome result = operation.attach(dr, mock(RequestDetails.class));
        assertThat(result.getIssueFirstRep().getSeverity())
            .isEqualTo(OperationOutcome.IssueSeverity.ERROR);
        verifyNoInteractions(processor);
    }
}
```

Run: `./gradlew test --tests "io.simintero.interop.attachments.AttachDocumentOperationTest" --no-daemon 2>&1 | tail -10`
Expected: FAIL with "cannot find symbol"

- [ ] **Step 2: Implement `AttachDocumentOperation.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachDocumentOperation.java`:
```java
package io.simintero.interop.attachments;

import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.ResourceParam;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Attachment;
import org.hl7.fhir.r4.model.DocumentReference;
import org.hl7.fhir.r4.model.Extension;
import org.hl7.fhir.r4.model.OperationOutcome;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * HAPI FHIR operation: POST /DocumentReference/$attach
 * Receives a DocumentReference with base64 C-CDA attachment and processes it through AttachmentProcessor.
 * Extensions carry RFAI correlation metadata (control number, claim ID, tenant ID, LOINC code).
 */
@Component
public class AttachDocumentOperation implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(AttachDocumentOperation.class);

    private static final String EXT_RFAI      = "http://simintero.io/fhir/StructureDefinition/rfai-control-number";
    private static final String EXT_CLAIM_ID  = "http://simintero.io/fhir/StructureDefinition/claim-id";
    private static final String EXT_TENANT_ID = "http://simintero.io/fhir/StructureDefinition/tenant-id";
    private static final String EXT_LOINC     = "http://simintero.io/fhir/StructureDefinition/loinc-code";

    private final AttachmentProcessor processor;

    public AttachDocumentOperation(AttachmentProcessor processor) {
        this.processor = processor;
    }

    @Override
    public Class<? extends IBaseResource> getResourceType() {
        return DocumentReference.class;
    }

    @Operation(name = "$attach", idempotent = false)
    public OperationOutcome attach(@ResourceParam DocumentReference docRef, RequestDetails request) {
        // Validate: must have at least one content attachment
        if (docRef.getContent().isEmpty()) {
            return errorOutcome("DocumentReference must contain at least one content attachment");
        }

        Attachment att = docRef.getContentFirstRep().getAttachment();
        if (att.getData() == null || att.getData().length == 0) {
            return errorOutcome("Attachment data is empty");
        }

        String controlNumber = stringExt(docRef, EXT_RFAI).orElse("UNKNOWN");
        String claimId       = stringExt(docRef, EXT_CLAIM_ID).orElse("UNKNOWN");
        String tenantId      = stringExt(docRef, EXT_TENANT_ID).orElse("unknown");
        String loincCode     = stringExt(docRef, EXT_LOINC).orElse(null);

        String ccdaBase64 = Base64.getEncoder().encodeToString(att.getData());
        List<String> loincCodes = loincCode != null ? List.of(loincCode) : List.of();

        ParsedAttachment275 parsed = new ParsedAttachment275(
            controlNumber, claimId, tenantId, ccdaBase64, loincCode
        );

        try {
            String docId = processor.process(parsed);
            log.info("[fhir-attach] processed rfaiId={} docId={}", controlNumber, docId);
            return infoOutcome("Attachment processed successfully. docId=" + docId);
        } catch (Exception ex) {
            log.error("[fhir-attach] processing failed rfaiId={} error={}", controlNumber, ex.getMessage());
            return errorOutcome("Processing failed: " + ex.getMessage());
        }
    }

    private static Optional<String> stringExt(DocumentReference dr, String url) {
        return dr.getExtension().stream()
            .filter(e -> url.equals(e.getUrl()))
            .map(Extension::getValue)
            .map(Object::toString)
            .findFirst();
    }

    private static OperationOutcome infoOutcome(String detail) {
        OperationOutcome oo = new OperationOutcome();
        oo.addIssue()
            .setSeverity(OperationOutcome.IssueSeverity.INFORMATION)
            .setCode(OperationOutcome.IssueType.INFORMATIONAL)
            .setDiagnostics(detail);
        return oo;
    }

    private static OperationOutcome errorOutcome(String detail) {
        OperationOutcome oo = new OperationOutcome();
        oo.addIssue()
            .setSeverity(OperationOutcome.IssueSeverity.ERROR)
            .setCode(OperationOutcome.IssueType.INVALID)
            .setDiagnostics(detail);
        return oo;
    }
}
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew test --tests "io.simintero.interop.attachments.AttachDocumentOperationTest" --no-daemon 2>&1 | tail -15
```
Expected: 2 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/java/io/simintero/interop/attachments/AttachDocumentOperation.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/AttachDocumentOperationTest.java
git commit -m "feat(interop): add FHIR DocumentReference/\$attach HAPI operation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Kafka consumers (`ClaimsAttachmentRequestedConsumer` + `ClearinghouseInbound275Consumer`)

**Files:**
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumer.java`
- Create: `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseInbound275Consumer.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumerTest.java`
- Create: `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClearinghouseInbound275ConsumerTest.java`

**Interfaces:**
- Consumes:
  - `claims.attachment.requested` topic: payload `{ claim_id, case_ref, loinc_codes[] }` (from outbox)
  - `clearinghouse.inbound.275` topic: raw X12 EDI string
- Depends on: `ClearinghouseRfaiClient` (Task 2), `X12v6020AttachmentParser` (Task 3), `AttachmentProcessor` (Task 4)
- Pattern: match `DecisionEventConsumer.java` — `@KafkaListener(topics="...", containerFactory="kafkaListenerContainerFactory")`, `FixedBackOff`, `DeadLetterPublishingRecoverer`, `Acknowledgment.acknowledge()` with `MANUAL_IMMEDIATE`

- [ ] **Step 1: Write the failing tests**

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumerTest.java`:
```java
package io.simintero.interop.attachments;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ClaimsAttachmentRequestedConsumerTest {

    @Mock ClearinghouseRfaiClient rfaiClient;
    @Mock JdbcTemplate jdbc;
    @Mock Acknowledgment ack;

    @InjectMocks ClaimsAttachmentRequestedConsumer consumer;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void sendsRfaiAndRecordsCorrelation() throws Exception {
        String payload = MAPPER.writeValueAsString(Map.of(
            "claim_id", "CLM-001",
            "case_ref", "case-001",
            "loinc_codes", List.of("11506-3"),
            "tenant_id", "tenant-dev"
        ));
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "claims.attachment.requested", 0, 0L, "CLM-001", payload);

        consumer.consume(record, ack);

        verify(rfaiClient).sendRfai(any(), eq("CLM-001"), eq("case-001"),
            eq(List.of("11506-3")), eq("tenant-dev"));
        verify(jdbc).update(contains("rfai_correlation"), any(Object[].class));
        verify(ack).acknowledge();
    }

    @Test
    void acknowledgesOnMalformedJson() {
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "claims.attachment.requested", 0, 1L, "k", "NOT JSON");
        consumer.consume(record, ack);
        verify(ack).acknowledge();
        verifyNoInteractions(rfaiClient);
    }
}
```

Create `services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClearinghouseInbound275ConsumerTest.java`:
```java
package io.simintero.interop.attachments;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ClearinghouseInbound275ConsumerTest {

    @Mock AttachmentProcessor processor;
    @Mock Acknowledgment ack;

    @InjectMocks ClearinghouseInbound275Consumer consumer;

    private static final String SAMPLE_275 = """
            ISA*00*          *00*          *ZZ*PROVIDER*ZZ*SIM*260101*1200*^*00601*CTRL001*0*P*:
            ST*275*0001
            BGN*11*CTRL001*20260101*1200
            TRN*1*RFAI-001
            REF*EJ*CLM-001
            REF*SIM*tenant-dev
            PWK*01*EL*11506-3
            BIN*10*PD94bWwgdmVyc2lvbj0iMS4wIj8+
            SE*8*0001
            IEA*1*CTRL001
            """;

    @Test
    void delegatesToProcessorAndAcknowledges() {
        when(processor.process(any())).thenReturn("doc-id-1");
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "clearinghouse.inbound.275", 0, 0L, "k", SAMPLE_275);

        consumer.consume(record, ack);

        verify(processor).process(any(ParsedAttachment275.class));
        verify(ack).acknowledge();
    }

    @Test
    void acknowledgesOnParseException() {
        ConsumerRecord<String, String> record = new ConsumerRecord<>(
            "clearinghouse.inbound.275", 0, 1L, "k", "INVALID EDI");

        consumer.consume(record, ack);

        verify(ack).acknowledge();
        verifyNoInteractions(processor);
    }
}
```

Run: `./gradlew test --tests "io.simintero.interop.attachments.*ConsumerTest" --no-daemon 2>&1 | tail -10`
Expected: FAIL with "cannot find symbol"

- [ ] **Step 2: Implement `ClaimsAttachmentRequestedConsumer.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumer.java`:
```java
package io.simintero.interop.attachments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Component
public class ClaimsAttachmentRequestedConsumer {

    private static final Logger log = LoggerFactory.getLogger(ClaimsAttachmentRequestedConsumer.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ClearinghouseRfaiClient rfaiClient;
    private final JdbcTemplate jdbc;

    public ClaimsAttachmentRequestedConsumer(ClearinghouseRfaiClient rfaiClient, JdbcTemplate jdbc) {
        this.rfaiClient = rfaiClient;
        this.jdbc = jdbc;
    }

    @KafkaListener(topics = "claims.attachment.requested",
                   containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        try {
            JsonNode payload = MAPPER.readTree(record.value());
            String claimId = payload.path("claim_id").asText();
            String caseRef = payload.path("case_ref").asText();
            String tenantId = payload.path("tenant_id").asText("unknown");

            List<String> loincCodes = new ArrayList<>();
            payload.path("loinc_codes").forEach(n -> loincCodes.add(n.asText()));

            String rfaiId = "RFAI-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();

            // Persist correlation BEFORE sending so the response can find it
            jdbc.update(
                "INSERT INTO interop.rfai_correlation (rfai_id, claim_id, tenant_id, case_ref, loinc_codes) "
                    + "VALUES (?, ?, ?, ?, ?::text[])",
                rfaiId, claimId, tenantId, caseRef, loincCodes.toArray(String[]::new)
            );

            rfaiClient.sendRfai(rfaiId, claimId, caseRef, loincCodes, tenantId);
            log.info("[rfai-consumer] sent rfaiId={} claimId={}", rfaiId, claimId);
        } catch (Exception ex) {
            log.error("[rfai-consumer] failed offset={} error={}", record.offset(), ex.getMessage());
        } finally {
            ack.acknowledge();
        }
    }
}
```

- [ ] **Step 3: Implement `ClearinghouseInbound275Consumer.java`**

Create `services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseInbound275Consumer.java`:
```java
package io.simintero.interop.attachments;

import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Component
public class ClearinghouseInbound275Consumer {

    private static final Logger log = LoggerFactory.getLogger(ClearinghouseInbound275Consumer.class);

    private final AttachmentProcessor processor;

    public ClearinghouseInbound275Consumer(AttachmentProcessor processor) {
        this.processor = processor;
    }

    @KafkaListener(topics = "clearinghouse.inbound.275",
                   containerFactory = "kafkaListenerContainerFactory")
    public void consume(ConsumerRecord<String, String> record, Acknowledgment ack) {
        try {
            ParsedAttachment275 parsed = X12v6020AttachmentParser.parse(record.value());
            String docId = processor.process(parsed);
            log.info("[275-consumer] processed rfaiId={} docId={}", parsed.controlNumber(), docId);
        } catch (AttachmentParseException ex) {
            log.error("[275-consumer] parse failed offset={} error={}", record.offset(), ex.getMessage());
        } catch (Exception ex) {
            log.error("[275-consumer] processing failed offset={} error={}", record.offset(), ex.getMessage());
        } finally {
            ack.acknowledge();
        }
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/services/enstellar-interop
./gradlew test --tests "io.simintero.interop.attachments.*ConsumerTest" --no-daemon 2>&1 | tail -15
```
Expected: 4 consumer tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
./gradlew test --no-daemon 2>&1 | tail -10
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumer.java \
        services/enstellar-interop/src/main/java/io/simintero/interop/attachments/ClearinghouseInbound275Consumer.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClaimsAttachmentRequestedConsumerTest.java \
        services/enstellar-interop/src/test/java/io/simintero/interop/attachments/ClearinghouseInbound275ConsumerTest.java
git commit -m "feat(interop): add Kafka consumers for claims attachment lifecycle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Clearinghouse inbound webhook (Node.js `inbound275.ts`)

**Files:**
- Create: `integration/connectors/clearinghouse/src/webhooks/inbound275.ts`
- Create: `integration/connectors/clearinghouse/src/webhooks/__tests__/inbound275.test.ts`
- Modify: `integration/connectors/clearinghouse/src/index.ts` (or the entry point — check what file mounts routes)

**Interfaces:**
- Produces:
  - `POST /webhooks/275` — receives raw X12 EDI body (Content-Type: `application/x12` or `text/plain`); publishes to `clearinghouse.inbound.275` Kafka topic; returns 200 `{ queued: true }`
  - `createInbound275Router(producer: KafkaProducer): Router`

> **Read first:** Look at `integration/connectors/clearinghouse/src/` to understand what Kafka producer library is used (kafkajs or @confluentinc/kafka-javascript), how topics are defined, and what the app's entry file looks like. Mirror the existing pattern exactly.

- [ ] **Step 1: Write the failing test**

Create `integration/connectors/clearinghouse/src/webhooks/__tests__/inbound275.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { createInbound275Router } from '../inbound275.js';

function makeProducer() {
  return { send: vi.fn().mockResolvedValue(undefined) } as any;
}

function makeApp(producer: ReturnType<typeof makeProducer>) {
  const app = express();
  app.use(express.text({ type: ['application/x12', 'text/plain', '*/*'] }));
  app.use('/webhooks', createInbound275Router(producer));
  return app;
}

const SAMPLE_275 = `ISA*00*          *00*          *ZZ*PROVIDER*ZZ*SIM*260101*1200*^*00601*CTRL001*0*P*:\nST*275*0001\nIEA*1*CTRL001\n`;

describe('POST /webhooks/275', () => {
  it('returns 200 and publishes to kafka', async () => {
    const producer = makeProducer();
    const res = await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .set('X-Sim-Tenant-Id', 'tenant-dev')
      .send(SAMPLE_275);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true });
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'clearinghouse.inbound.275',
      messages: [expect.objectContaining({ value: SAMPLE_275 })],
    });
  });

  it('returns 400 when body is empty', async () => {
    const producer = makeProducer();
    const res = await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .send('');
    expect(res.status).toBe(400);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it('includes tenant header as kafka message key', async () => {
    const producer = makeProducer();
    await supertest(makeApp(producer))
      .post('/webhooks/275')
      .set('Content-Type', 'application/x12')
      .set('X-Sim-Tenant-Id', 'tenant-abc')
      .send(SAMPLE_275);
    expect(producer.send).toHaveBeenCalledWith({
      topic: 'clearinghouse.inbound.275',
      messages: [expect.objectContaining({ key: 'tenant-abc' })],
    });
  });
});
```

Run: `cd integration/connectors/clearinghouse && pnpm test 2>&1 | grep -E "inbound275|Cannot find|FAIL"`
Expected: FAIL with "Cannot find module"

- [ ] **Step 2: Implement `inbound275.ts`**

Create `integration/connectors/clearinghouse/src/webhooks/inbound275.ts`:
```typescript
import express from 'express';

interface KafkaProducer {
  send(args: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<void>;
}

export function createInbound275Router(producer: KafkaProducer): express.Router {
  const router = express.Router();

  router.post('/275', async (req, res) => {
    const body = req.body as string;
    if (!body || body.trim().length === 0) {
      return res.status(400).json({ error: 'Body is required' });
    }

    const tenantId = (req.headers['x-sim-tenant-id'] as string | undefined) ?? 'unknown';

    try {
      await producer.send({
        topic: 'clearinghouse.inbound.275',
        messages: [{ key: tenantId, value: body }],
      });
      return res.status(200).json({ queued: true });
    } catch (err) {
      console.error('[inbound275] kafka send failed', err);
      return res.status(500).json({ error: 'Failed to queue message' });
    }
  });

  return router;
}
```

- [ ] **Step 3: Run the tests**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/integration/connectors/clearinghouse
pnpm test -- --reporter=verbose 2>&1 | tail -15
```
Expected: 3 new tests PASS, all existing tests still green.

- [ ] **Step 4: Mount the router in the clearinghouse entry point**

Read the clearinghouse entry file (likely `integration/connectors/clearinghouse/src/index.ts` or `app.ts`). Find where existing routes are mounted. Add:

```typescript
import { Kafka } from 'kafkajs'; // or whatever producer library is used
import express from 'express';
import { createInbound275Router } from './webhooks/inbound275.js';

// In the app setup, after express.json() / express.text() middleware:
app.use(express.text({ type: ['application/x12', 'text/plain', '*/*'] }));
app.use('/webhooks', createInbound275Router(producer));
```

Match the existing entry file's pattern exactly — if it uses a `buildApp(producer)` factory, add the route there. If it initializes the producer differently, use the same producer instance.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero/integration/connectors/clearinghouse
pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/simintero
git add integration/connectors/clearinghouse/src/webhooks/inbound275.ts \
        integration/connectors/clearinghouse/src/webhooks/__tests__/inbound275.test.ts \
        integration/connectors/clearinghouse/src/index.ts
git commit -m "feat(clearinghouse): add inbound X12 275 webhook that publishes to clearinghouse.inbound.275

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

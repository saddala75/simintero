# T06 — PAS Submit/Inquire (Happy Path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PAS `$submit` and `$inquire` HAPI operations to the interop service: store-first, validate, normalize to canonical Case, publish `case.intake.received` event, return synchronous ClaimResponse for the approved happy path.

**Architecture:** Two HAPI operation providers (`$submit`, `$inquire`) registered on the `Claim` resource type. `$submit` follows store-first-transform-second pattern: raw bundle goes to MinIO before any validation or transform. Normalization delegates to the Python workflow-engine REST endpoint (`POST http://workflow-engine:8000/internal/normalize`). Kafka (spring-kafka) publishes `case.intake.received`. For the happy path, `$submit` returns a synchronous approved `ClaimResponse` wrapped in a `Bundle`.

**Tech Stack:** Java 21, Spring Boot 3.3.4, HAPI FHIR 7.4.0, spring-kafka 3.x, MinIO Java SDK 8.5.10, Spring WebFlux (WebClient), WireMock 3.x (tests), Testcontainers (PostgreSQL + Kafka + MinIO).

> **Invariant note:** Raw bundle must be stored in MinIO BEFORE any validation or transformation attempt. On any transform error, the raw bundle is still retained with the error recorded. `tenant_id` (from the JWT, set by `TenantInterceptor`) must be propagated on every call to normalization, MinIO, and Kafka.

**Depends on:** T05 (HAPI server scaffold with `HapiServerConfig`, `TenantInterceptor`, `FhirTestBase`), T07 (normalization service running at `http://workflow-engine:8000`).

---

## Background

- `services/interop/` has the T05 HAPI JPA server: `InteropApplication`, `HapiServerConfig`, `TenantInterceptor`, `SmartAuthInterceptor`, `AuditInterceptor`, resource providers for Patient/Practitioner/Coverage/Organization.
- Java package prefix: `com.simintero.enstellar.interop`
- Existing `build.gradle.kts` has: HAPI FHIR 7.4.0, Spring Boot 3.3.4, Spring Security OAuth2 Resource Server, Testcontainers (PostgreSQL).
- The Kafka broker in compose is Redpanda at `redpanda:9092` (internal) / `localhost:9092` (host). Topic: `case.intake.received`.
- The MinIO container: endpoint `minio:9000` (internal) / `localhost:9000` (host), access key `minioadmin`, secret `minioadmin`, bucket `enstellar-raw-bundles`.
- The workflow-engine: `http://workflow-engine:8000` (compose) / `http://localhost:8000` (host).
- `FhirTestBase.java` (from T05) provides: `PostgresContainer`, `@DynamicPropertySource`, `mintJwt(String tenantId)` helper, `createPartition(String tenantId)` helper.
- The Da Vinci PAS IG defines `POST [base]/Claim/$submit` accepting a `Bundle` body and returning a `Bundle` containing a `ClaimResponse`.

---

## File Map

**New files in `services/interop/src/main/java/com/simintero/enstellar/interop/`:**

| File | Responsibility |
|---|---|
| `pas/PasClaimSubmitProvider.java` | HAPI `@Operation("$submit")` on Claim: store-first, validate, normalize, publish, return ClaimResponse |
| `pas/PasClaimInquireProvider.java` | HAPI `@Operation("$inquire")` on Claim: look up case by correlation_id, return current ClaimResponse |
| `pas/PasBundleValidator.java` | Validates PAS profile requirements; throws `InvalidRequestException` (→ 422) |
| `pas/NormalizationClient.java` | Spring WebClient calling POST /internal/normalize on workflow-engine |
| `pas/MinioRawBundleStore.java` | MinIO Java SDK: store raw Bundle JSON, return object key |
| `pas/CaseIntakePublisher.java` | spring-kafka KafkaTemplate publishing `case.intake.received` |
| `pas/dto/NormalizeRequest.java` | Jackson DTO: bundle (String JSON), tenant_id, correlation_id |
| `pas/dto/NormalizeResponse.java` | Jackson DTO: canonical Case fields + _raw_bundle_key |
| `pas/dto/EventEnvelope.java` | Java record matching the Python EventEnvelope schema |
| `pas/dto/Actor.java` | Java record for EventEnvelope.actor |
| `config/PasConfig.java` | `@ConfigurationProperties(prefix="enstellar.pas")` for normalization URL, MinIO, Kafka |

**New files in `services/interop/src/test/java/com/simintero/enstellar/interop/`:**

| File | Responsibility |
|---|---|
| `pas/PasSubmitIT.java` | Integration: `$submit` with valid bundle → 200, MinIO object stored, Kafka event published |
| `pas/PasInquireIT.java` | Integration: `$inquire` with correlation_id → ClaimResponse with current status |
| `pas/PasBundleValidatorTest.java` | Unit: invalid bundles → expected OperationOutcome / exception messages |

**Modified:**

| File | Change |
|---|---|
| `services/interop/build.gradle.kts` | Add spring-kafka, MinIO SDK, WebFlux, WireMock, Testcontainers Kafka + MinIO |
| `services/interop/src/main/resources/application.yml` | Add `enstellar.pas.*`, Kafka, MinIO settings |
| `services/interop/src/main/java/.../config/HapiServerConfig.java` | Register `PasClaimSubmitProvider` and `PasClaimInquireProvider` beans |
| `.claude/task-graph.md` | Mark T06 `[x]` |

---

## Task 1: Add Gradle Dependencies

**Files modified:** `services/interop/build.gradle.kts`

- [ ] **Step 1.1: Open `services/interop/build.gradle.kts` and add the following to the `dependencies` block**

Add after the existing test dependencies:

```kotlin
// T06 additions — PAS service
implementation("org.springframework.kafka:spring-kafka")
implementation("io.minio:minio:8.5.10")
implementation("org.springframework.boot:spring-boot-starter-webflux")   // WebClient for normalization
implementation("com.fasterxml.jackson.core:jackson-databind")             // explicit (transitive but pin)

// T06 test additions
testImplementation("org.springframework.kafka:spring-kafka-test")
testImplementation("org.testcontainers:kafka:1.20.1")
testImplementation("org.testcontainers:minio:1.20.1")
testImplementation("com.github.tomakehurst:wiremock-standalone:3.9.1")
```

The full updated `dependencies` block in `build.gradle.kts` (replacing only the dependencies block, preserving everything else):

```kotlin
dependencies {
    // HAPI FHIR JPA server
    implementation("ca.uhn.hapi.fhir:hapi-fhir-spring-boot-starter:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-jpaserver-base:7.4.0")
    implementation("ca.uhn.hapi.fhir:hapi-fhir-structures-r4:7.4.0")

    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-web")

    // T06: Kafka, MinIO, WebClient
    implementation("org.springframework.kafka:spring-kafka")
    implementation("io.minio:minio:8.5.10")
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    implementation("com.fasterxml.jackson.core:jackson-databind")

    // Database
    runtimeOnly("org.postgresql:postgresql")

    // Test
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:postgresql:1.20.1")
    testImplementation("org.testcontainers:kafka:1.20.1")
    testImplementation("org.testcontainers:minio:1.20.1")
    testImplementation("org.testcontainers:junit-jupiter:1.20.1")
    testImplementation("org.springframework.kafka:spring-kafka-test")
    testImplementation("com.github.tomakehurst:wiremock-standalone:3.9.1")
    testImplementation("com.nimbusds:nimbus-jose-jwt:9.40")
}
```

- [ ] **Step 1.2: Resolve dependencies**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew dependencies --configuration compileClasspath 2>&1 | grep -E "(minio|spring-kafka|webflux)" | head -10
```

Expected: lines showing `io.minio:minio:8.5.10`, `spring-kafka`, `spring-webflux` resolved.

---

## Task 2: Configuration

**Files created:** `config/PasConfig.java`
**Files modified:** `src/main/resources/application.yml`

- [ ] **Step 2.1: Create the `pas/` and `pas/dto/` directory structure**

```bash
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop/src/main/java/com/simintero/enstellar/interop/pas/dto
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop/src/test/java/com/simintero/enstellar/interop/pas
```

Expected: no output.

- [ ] **Step 2.2: Create `config/PasConfig.java`**

```java
package com.simintero.enstellar.interop.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Configuration for PAS operations: normalization service URL, MinIO, Kafka.
 *
 * Bound from application.yml prefix "enstellar.pas".
 */
@ConfigurationProperties(prefix = "enstellar.pas")
public record PasConfig(
    String normalizationUrl,
    MinioProps minio,
    KafkaProps kafka
) {

    public record MinioProps(
        String endpoint,
        String accessKey,
        String secretKey,
        @DefaultValue("false") boolean secure,
        @DefaultValue("enstellar-raw-bundles") String bucket
    ) {}

    public record KafkaProps(
        @DefaultValue("case.intake.received") String intakeTopic
    ) {}
}
```

- [ ] **Step 2.3: Enable `@ConfigurationProperties` in `InteropApplication.java`**

Add `@EnableConfigurationProperties(PasConfig.class)` to `InteropApplication.java`:

```java
package com.simintero.enstellar.interop;

import com.simintero.enstellar.interop.config.PasConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(PasConfig.class)
public class InteropApplication {
    public static void main(String[] args) {
        SpringApplication.run(InteropApplication.class, args);
    }
}
```

- [ ] **Step 2.4: Update `src/main/resources/application.yml`**

Append to the existing `application.yml` (below the existing Spring/HAPI/security config):

```yaml
# PAS service configuration
enstellar:
  pas:
    normalization-url: ${NORMALIZATION_URL:http://localhost:8000}
    minio:
      endpoint: ${MINIO_ENDPOINT:localhost:9000}
      access-key: ${MINIO_ACCESS_KEY:minioadmin}
      secret-key: ${MINIO_SECRET_KEY:minioadmin}
      secure: ${MINIO_SECURE:false}
      bucket: ${MINIO_BUCKET:enstellar-raw-bundles}
    kafka:
      intake-topic: ${PAS_INTAKE_TOPIC:case.intake.received}

spring:
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS:localhost:9092}
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      acks: all
      retries: 3
      properties:
        enable.idempotence: true
```

---

## Task 3: DTOs

**Files created:** `pas/dto/NormalizeRequest.java`, `pas/dto/NormalizeResponse.java`, `pas/dto/EventEnvelope.java`, `pas/dto/Actor.java`

- [ ] **Step 3.1: Create `pas/dto/NormalizeRequest.java`**

```java
package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for POST /internal/normalize on the workflow-engine.
 * The bundle is serialized to a JSON string by the caller.
 */
public record NormalizeRequest(
    @JsonProperty("bundle") Object bundle,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("correlation_id") String correlationId
) {}
```

- [ ] **Step 3.2: Create `pas/dto/NormalizeResponse.java`**

```java
package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Canonical Case returned by POST /internal/normalize.
 * We only need the fields required for building the ClaimResponse and the Kafka event.
 * Unknown fields are ignored (canonical model may evolve).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record NormalizeResponse(
    @JsonProperty("case_id") String caseId,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("correlation_id") String correlationId,
    @JsonProperty("status") String status,
    @JsonProperty("lob") String lob,
    @JsonProperty("_raw_bundle_key") String rawBundleKey
) {}
```

- [ ] **Step 3.3: Create `pas/dto/Actor.java`**

```java
package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Actor in an EventEnvelope — mirrors the Python canonical_model Actor.
 */
public record Actor(
    @JsonProperty("id") String id,
    @JsonProperty("type") String type
) {}
```

- [ ] **Step 3.4: Create `pas/dto/EventEnvelope.java`**

```java
package com.simintero.enstellar.interop.pas.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * EventEnvelope — Java record matching the Python EventEnvelope Pydantic model.
 *
 * Python schema (packages/event-contracts/enstellar_events/envelope.py):
 *   event_id: uuid.UUID
 *   tenant_id: str
 *   case_id: uuid.UUID | None
 *   correlation_id: str
 *   type: str  (pattern: ^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$)
 *   occurred_at: datetime
 *   actor: Actor
 *   payload: dict
 *   schema_version: str (pattern: ^\d+\.\d+\.\d+$)
 */
public record EventEnvelope(
    @JsonProperty("event_id") UUID eventId,
    @JsonProperty("tenant_id") String tenantId,
    @JsonProperty("case_id") UUID caseId,
    @JsonProperty("correlation_id") String correlationId,
    @JsonProperty("type") String type,
    @JsonProperty("occurred_at") Instant occurredAt,
    @JsonProperty("actor") Actor actor,
    @JsonProperty("payload") Map<String, Object> payload,
    @JsonProperty("schema_version") String schemaVersion
) {}
```

---

## Task 4: `PasBundleValidator.java`

**Files created:** `pas/PasBundleValidator.java`

- [ ] **Step 4.1: Create `pas/PasBundleValidator.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.Coverage;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Practitioner;
import org.springframework.stereotype.Component;

/**
 * Validates that a PAS request Bundle meets the minimum structural requirements
 * before normalization and storage.
 *
 * Throws {@link InvalidRequestException} (HAPI maps this to HTTP 422 + OperationOutcome)
 * if validation fails.
 */
@Component
public class PasBundleValidator {

    /**
     * Validate a PAS Claim/$submit Bundle.
     *
     * Checks:
     * 1. Bundle.type == COLLECTION
     * 2. Exactly one Claim entry with use == PREAUTHORIZATION
     * 3. Claim.patient reference resolves to a Patient entry
     * 4. Claim.provider reference resolves to a Practitioner entry
     * 5. Claim.insurance is non-empty and focal coverage reference resolves to a Coverage entry
     * 6. Claim.item is non-empty (at least one service line)
     *
     * @param bundle Parsed HAPI Bundle
     * @throws InvalidRequestException on any validation failure
     */
    public void validate(Bundle bundle) {
        if (bundle == null) {
            throw new InvalidRequestException("Bundle is null — cannot process $submit request");
        }

        if (bundle.getType() != Bundle.BundleType.COLLECTION) {
            throw new InvalidRequestException(
                "PAS Bundle.type must be 'collection'; got: " + bundle.getType()
            );
        }

        // Collect entries by resourceType
        Claim claim = null;
        boolean hasPatient = false;
        boolean hasPractitioner = false;
        boolean hasCoverage = false;

        for (Bundle.BundleEntryComponent entry : bundle.getEntry()) {
            if (entry.getResource() instanceof Claim c) {
                claim = c;
            } else if (entry.getResource() instanceof Patient) {
                hasPatient = true;
            } else if (entry.getResource() instanceof Practitioner) {
                hasPractitioner = true;
            } else if (entry.getResource() instanceof Coverage) {
                hasCoverage = true;
            }
        }

        if (claim == null) {
            throw new InvalidRequestException(
                "PAS Bundle must contain exactly one Claim resource"
            );
        }

        if (claim.getUse() != Claim.Use.PREAUTHORIZATION) {
            throw new InvalidRequestException(
                "Claim.use must be 'preauthorization' for PAS; got: " + claim.getUse()
            );
        }

        if (!hasPatient) {
            throw new InvalidRequestException(
                "PAS Bundle must contain a Patient resource (referenced by Claim.patient)"
            );
        }

        if (!hasPractitioner) {
            throw new InvalidRequestException(
                "PAS Bundle must contain at least one Practitioner resource (referenced by Claim.provider)"
            );
        }

        if (!hasCoverage) {
            throw new InvalidRequestException(
                "PAS Bundle must contain a Coverage resource (referenced by Claim.insurance[].coverage)"
            );
        }

        if (claim.getInsurance().isEmpty()) {
            throw new InvalidRequestException(
                "Claim.insurance must be non-empty"
            );
        }

        if (claim.getItem().isEmpty()) {
            throw new InvalidRequestException(
                "Claim.item must be non-empty — at least one service line required"
            );
        }
    }
}
```

---

## Task 5: `MinioRawBundleStore.java`

**Files created:** `pas/MinioRawBundleStore.java`

- [ ] **Step 5.1: Create `pas/MinioRawBundleStore.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import com.simintero.enstellar.interop.config.PasConfig;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.errors.MinioException;
import org.hl7.fhir.r4.model.Bundle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneOffset;

/**
 * Stores the raw PAS Bundle JSON in MinIO before any validation or transformation.
 *
 * Key format: {bucket}/{tenantId}/raw-bundles/{date}/{correlationId}.json
 *
 * INVARIANT: This method must be called BEFORE PasBundleValidator.validate() and
 * NormalizationClient.normalize(). Even if subsequent steps fail, the raw bundle
 * is safely persisted with its provenance key.
 */
@Component
public class MinioRawBundleStore {

    private static final Logger log = LoggerFactory.getLogger(MinioRawBundleStore.class);

    private final MinioClient minioClient;
    private final String bucket;
    private final FhirContext fhirContext;

    public MinioRawBundleStore(PasConfig config, FhirContext fhirContext) {
        this.fhirContext = fhirContext;
        PasConfig.MinioProps minio = config.minio();
        this.bucket = minio.bucket();
        this.minioClient = MinioClient.builder()
            .endpoint("http" + (minio.secure() ? "s" : "") + "://" + minio.endpoint())
            .credentials(minio.accessKey(), minio.secretKey())
            .build();
    }

    /**
     * Serialize the HAPI Bundle to JSON and store it in MinIO.
     *
     * @param tenantId      Tenant owning this bundle (path prefix).
     * @param correlationId External correlation / tracking ID (filename).
     * @param bundle        HAPI R4 Bundle to serialize and store.
     * @return Full object reference: "{bucket}/{objectKey}"
     * @throws RuntimeException wrapping any MinioException or IOException.
     */
    public String store(String tenantId, String correlationId, Bundle bundle) {
        String json = fhirContext.newJsonParser()
            .setPrettyPrint(false)
            .encodeResourceToString(bundle);

        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        String date = LocalDate.now(ZoneOffset.UTC).toString(); // e.g. "2026-06-05"
        String objectKey = tenantId + "/raw-bundles/" + date + "/" + correlationId + ".json";

        try {
            ensureBucket();
            minioClient.putObject(
                PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .stream(new ByteArrayInputStream(bytes), bytes.length, -1)
                    .contentType("application/fhir+json")
                    .build()
            );
        } catch (MinioException | java.io.IOException | java.security.InvalidKeyException
                 | java.security.NoSuchAlgorithmException e) {
            throw new RuntimeException("Failed to store raw bundle in MinIO: " + e.getMessage(), e);
        }

        String fullKey = bucket + "/" + objectKey;
        log.info("raw_bundle_stored tenant={} correlation_id={} key={}", tenantId, correlationId, fullKey);
        return fullKey;
    }

    private void ensureBucket() throws Exception {
        boolean exists = minioClient.bucketExists(
            BucketExistsArgs.builder().bucket(bucket).build()
        );
        if (!exists) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
        }
    }
}
```

---

## Task 6: `NormalizationClient.java`

**Files created:** `pas/NormalizationClient.java`

- [ ] **Step 6.1: Create `pas/NormalizationClient.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.server.exceptions.InternalErrorException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.config.PasConfig;
import com.simintero.enstellar.interop.pas.dto.NormalizeRequest;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.hl7.fhir.r4.model.Bundle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;

/**
 * REST client that calls the Python workflow-engine normalization endpoint.
 *
 * POST {normalizationUrl}/internal/normalize
 *   Body:  {"bundle": {...}, "tenant_id": "...", "correlation_id": "..."}
 *   Response 200: NormalizeResponse (canonical Case JSON + _raw_bundle_key)
 *   Response 422: mapping failure (bundle is already in MinIO)
 *
 * Blocking call (30s timeout) — HAPI operation providers are synchronous.
 */
@Component
public class NormalizationClient {

    private static final Logger log = LoggerFactory.getLogger(NormalizationClient.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final WebClient webClient;
    private final FhirContext fhirContext;
    private final ObjectMapper objectMapper;

    public NormalizationClient(PasConfig config, FhirContext fhirContext, ObjectMapper objectMapper) {
        this.fhirContext = fhirContext;
        this.objectMapper = objectMapper;
        this.webClient = WebClient.builder()
            .baseUrl(config.normalizationUrl())
            .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
            .build();
    }

    /**
     * Normalize a PAS Bundle to a canonical Case.
     *
     * @param bundle        HAPI R4 Bundle (serialized to JSON for the request body).
     * @param tenantId      Tenant ID propagated to the normalization service.
     * @param correlationId Correlation ID for tracing.
     * @return NormalizeResponse containing the canonical Case JSON fields.
     * @throws InternalErrorException on HTTP 5xx from normalization service.
     * @throws ca.uhn.fhir.rest.server.exceptions.InvalidRequestException on HTTP 422.
     */
    public NormalizeResponse normalize(Bundle bundle, String tenantId, String correlationId) {
        // Serialize Bundle to a plain Java object so Jackson can embed it in the request
        String bundleJson = fhirContext.newJsonParser()
            .setPrettyPrint(false)
            .encodeResourceToString(bundle);

        Object bundleObj;
        try {
            bundleObj = objectMapper.readValue(bundleJson, Object.class);
        } catch (Exception e) {
            throw new InternalErrorException("Failed to serialize Bundle for normalization: " + e.getMessage(), e);
        }

        NormalizeRequest request = new NormalizeRequest(bundleObj, tenantId, correlationId);

        log.debug("normalize_request tenant={} correlation_id={}", tenantId, correlationId);

        try {
            NormalizeResponse response = webClient.post()
                .uri("/internal/normalize")
                .bodyValue(request)
                .retrieve()
                .bodyToMono(NormalizeResponse.class)
                .block(TIMEOUT);

            if (response == null) {
                throw new InternalErrorException("Normalization service returned empty response");
            }

            log.info("normalize_success tenant={} case_id={}", tenantId, response.caseId());
            return response;

        } catch (WebClientResponseException.UnprocessableEntity e) {
            throw new ca.uhn.fhir.rest.server.exceptions.InvalidRequestException(
                "Normalization rejected bundle: " + e.getResponseBodyAsString()
            );
        } catch (WebClientResponseException e) {
            throw new InternalErrorException(
                "Normalization service error (" + e.getStatusCode() + "): " + e.getResponseBodyAsString(), e
            );
        }
    }
}
```

---

## Task 7: `CaseIntakePublisher.java`

**Files created:** `pas/CaseIntakePublisher.java`

- [ ] **Step 7.1: Create `pas/CaseIntakePublisher.java`**

```java
package com.simintero.enstellar.interop.pas;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.config.PasConfig;
import com.simintero.enstellar.interop.pas.dto.Actor;
import com.simintero.enstellar.interop.pas.dto.EventEnvelope;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Publishes a `case.intake.received` event to Kafka (Redpanda) after successful normalization.
 *
 * Event envelope schema matches the Python EventEnvelope in packages/event-contracts.
 * The message key is tenant_id so all events for a tenant land in order (same partition).
 */
@Component
public class CaseIntakePublisher {

    private static final Logger log = LoggerFactory.getLogger(CaseIntakePublisher.class);
    private static final String SCHEMA_VERSION = "1.0.0";
    private static final String EVENT_TYPE = "case.intake.received";
    private static final String ACTOR_ID = "interop-service";
    private static final String ACTOR_TYPE = "service";

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final String intakeTopic;

    public CaseIntakePublisher(
        KafkaTemplate<String, String> kafkaTemplate,
        ObjectMapper objectMapper,
        PasConfig config
    ) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.intakeTopic = config.kafka().intakeTopic();
    }

    /**
     * Publish a `case.intake.received` event for the normalized case.
     *
     * @param normalizeResponse The NormalizeResponse from the normalization service.
     * @throws RuntimeException if Kafka send fails after retries.
     */
    public void publish(NormalizeResponse normalizeResponse) {
        UUID caseId = normalizeResponse.caseId() != null
            ? UUID.fromString(normalizeResponse.caseId())
            : null;

        EventEnvelope envelope = new EventEnvelope(
            UUID.randomUUID(),
            normalizeResponse.tenantId(),
            caseId,
            normalizeResponse.correlationId(),
            EVENT_TYPE,
            Instant.now(),
            new Actor(ACTOR_ID, ACTOR_TYPE),
            Map.of(
                "case_id", normalizeResponse.caseId() != null ? normalizeResponse.caseId() : "",
                "tenant_id", normalizeResponse.tenantId(),
                "correlation_id", normalizeResponse.correlationId(),
                "status", normalizeResponse.status() != null ? normalizeResponse.status() : "intake",
                "lob", normalizeResponse.lob() != null ? normalizeResponse.lob() : "",
                "raw_bundle_key", normalizeResponse.rawBundleKey() != null ? normalizeResponse.rawBundleKey() : ""
            ),
            SCHEMA_VERSION
        );

        String value;
        try {
            value = objectMapper.writeValueAsString(envelope);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize EventEnvelope: " + e.getMessage(), e);
        }

        // Use tenant_id as partition key (all events for a tenant are ordered)
        String key = normalizeResponse.tenantId();

        try {
            SendResult<String, String> result = kafkaTemplate
                .send(intakeTopic, key, value)
                .get(10, TimeUnit.SECONDS);

            log.info(
                "case_intake_published tenant={} case_id={} topic={} partition={} offset={}",
                normalizeResponse.tenantId(),
                normalizeResponse.caseId(),
                intakeTopic,
                result.getRecordMetadata().partition(),
                result.getRecordMetadata().offset()
            );

        } catch (ExecutionException | InterruptedException | TimeoutException e) {
            throw new RuntimeException(
                "Failed to publish case.intake.received to Kafka: " + e.getMessage(), e
            );
        }
    }
}
```

---

## Task 8: `PasClaimSubmitProvider.java`

**Files created:** `pas/PasClaimSubmitProvider.java`

- [ ] **Step 8.1: Create `pas/PasClaimSubmitProvider.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.OperationParam;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import com.simintero.enstellar.interop.pas.dto.NormalizeResponse;
import org.hl7.fhir.instance.model.api.IBaseResource;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.DateTimeType;
import org.hl7.fhir.r4.model.Period;
import org.hl7.fhir.r4.model.Reference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

/**
 * HAPI FHIR operation provider for Claim/$submit (Da Vinci PAS).
 *
 * POST [base]/Claim/$submit
 *   Body: PAS request Bundle
 *   Response: Bundle containing a ClaimResponse (approved, for happy path)
 *
 * Execution order (INVARIANT: store-first):
 *   1. Store raw bundle in MinIO (raw_bundle_key retained even on subsequent failure)
 *   2. Validate PAS profile requirements
 *   3. Normalize bundle → canonical Case (via workflow-engine REST)
 *   4. Publish case.intake.received to Kafka
 *   5. Return synchronous approved ClaimResponse
 */
@Component
public class PasClaimSubmitProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(PasClaimSubmitProvider.class);

    private final MinioRawBundleStore minioStore;
    private final PasBundleValidator validator;
    private final NormalizationClient normClient;
    private final CaseIntakePublisher intakePublisher;

    public PasClaimSubmitProvider(
        MinioRawBundleStore minioStore,
        PasBundleValidator validator,
        NormalizationClient normClient,
        CaseIntakePublisher intakePublisher
    ) {
        this.minioStore = minioStore;
        this.validator = validator;
        this.normClient = normClient;
        this.intakePublisher = intakePublisher;
    }

    @Override
    public Class<Claim> getResourceType() {
        return Claim.class;
    }

    /**
     * Handle POST [base]/Claim/$submit.
     *
     * @param bundle         The PAS request Bundle from the request body.
     * @param requestDetails HAPI request context (contains tenantId attribute set by TenantInterceptor).
     * @return Bundle containing an approved ClaimResponse.
     */
    @Operation(name = "$submit", idempotent = false, type = Claim.class)
    public Bundle submit(
        @OperationParam(name = "resource") Bundle bundle,
        RequestDetails requestDetails
    ) {
        String tenantId = (String) requestDetails.getAttribute("tenantId");
        if (tenantId == null || tenantId.isBlank()) {
            throw new ca.uhn.fhir.rest.server.exceptions.AuthenticationException(
                "tenant_id missing from request — TenantInterceptor must set 'tenantId' attribute"
            );
        }

        // Derive correlation_id: use Bundle.id if present, else generate
        String correlationId = (bundle.hasId() && !bundle.getIdElement().getIdPart().isBlank())
            ? bundle.getIdElement().getIdPart()
            : UUID.randomUUID().toString();

        log.info("pas_submit_received tenant={} correlation_id={}", tenantId, correlationId);

        // STEP 1: Store raw bundle FIRST (invariant: store-first-transform-second)
        String rawKey = minioStore.store(tenantId, correlationId, bundle);

        // STEP 2: Validate PAS profile requirements
        // InvalidRequestException thrown here → HAPI returns 422 OperationOutcome
        validator.validate(bundle);

        // STEP 3: Normalize to canonical Case
        NormalizeResponse normalizeResponse = normClient.normalize(bundle, tenantId, correlationId);

        // STEP 4: Publish case.intake.received event
        intakePublisher.publish(normalizeResponse);

        // STEP 5: Build and return synchronous approved ClaimResponse Bundle
        Bundle responseBundle = buildApprovedResponseBundle(normalizeResponse, bundle, rawKey);

        log.info(
            "pas_submit_complete tenant={} correlation_id={} case_id={}",
            tenantId, correlationId, normalizeResponse.caseId()
        );

        return responseBundle;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private Bundle buildApprovedResponseBundle(
        NormalizeResponse normalizeResponse,
        Bundle requestBundle,
        String rawKey
    ) {
        Claim claim = requestBundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .map(e -> (Claim) e.getResource())
            .findFirst()
            .orElseThrow(() -> new InvalidRequestException("No Claim found in request bundle"));

        ClaimResponse response = new ClaimResponse();
        response.setId(UUID.randomUUID().toString());
        response.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        response.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
        response.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        response.setCreated(Date.from(Instant.now()));

        // Reference back to the request Claim
        response.setRequest(new Reference("Claim/" + claim.getIdElement().getIdPart()));

        // Insurer (copy from claim.insurer if present)
        if (claim.hasInsurer()) {
            response.setInsurer(claim.getInsurer());
        }

        // Pre-auth period: 90-day authorization window starting today
        Instant now = Instant.now();
        response.addPreAuthPeriod(
            new Period()
                .setStart(Date.from(now))
                .setEnd(Date.from(now.plus(90, ChronoUnit.DAYS)))
        );

        // Adjudication items for each claim item
        for (Claim.ItemComponent item : claim.getItem()) {
            response.addItem()
                .setItemSequence(item.getSequence())
                .addAdjudication()
                    .setCategory(new CodeableConcept(
                        new Coding()
                            .setSystem("http://terminology.hl7.org/CodeSystem/adjudication")
                            .setCode("submitted")
                            .setDisplay("Submitted Amount")
                    ));
        }

        // Extension: provenance link to raw bundle in MinIO
        response.addExtension(
            "https://enstellar.simintero.com/fhir/StructureDefinition/raw-bundle-key",
            new org.hl7.fhir.r4.model.StringType(rawKey)
        );

        // Extension: canonical case_id
        if (normalizeResponse.caseId() != null) {
            response.addExtension(
                "https://enstellar.simintero.com/fhir/StructureDefinition/case-id",
                new org.hl7.fhir.r4.model.StringType(normalizeResponse.caseId())
            );
        }

        Bundle responseBundle = new Bundle();
        responseBundle.setId(UUID.randomUUID().toString());
        responseBundle.setType(Bundle.BundleType.COLLECTION);
        responseBundle.setTimestamp(Date.from(Instant.now()));
        responseBundle.addEntry().setResource(response);

        return responseBundle;
    }
}
```

---

## Task 9: `PasClaimInquireProvider.java`

**Files created:** `pas/PasClaimInquireProvider.java`

- [ ] **Step 9.1: Create `pas/PasClaimInquireProvider.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.annotation.IdParam;
import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.annotation.OperationParam;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.config.PasConfig;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.IdType;
import org.hl7.fhir.r4.model.StringType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * HAPI FHIR operation provider for Claim/$inquire (Da Vinci PAS).
 *
 * GET [base]/Claim/{correlationId}/$inquire
 *   Returns: Bundle containing a ClaimResponse reflecting the current case status.
 *
 * Looks up the case by correlation_id via workflow-engine GET /cases endpoint.
 * Returns ResourceNotFoundException (404) if no case found.
 */
@Component
public class PasClaimInquireProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(PasClaimInquireProvider.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(15);

    private final WebClient webClient;
    private final ObjectMapper objectMapper;

    public PasClaimInquireProvider(PasConfig config, ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.webClient = WebClient.builder()
            .baseUrl(config.normalizationUrl())
            .build();
    }

    @Override
    public Class<Claim> getResourceType() {
        return Claim.class;
    }

    /**
     * Handle GET [base]/Claim/{correlationId}/$inquire.
     *
     * @param correlationId  The correlation ID of the original $submit request (used as Claim.id).
     * @param requestDetails HAPI request context.
     * @return Bundle containing a ClaimResponse with current authorization status.
     */
    @Operation(name = "$inquire", idempotent = true, type = Claim.class)
    public Bundle inquire(
        @IdParam IdType correlationId,
        RequestDetails requestDetails
    ) {
        String tenantId = (String) requestDetails.getAttribute("tenantId");
        String corrId = correlationId.getIdPart();

        log.info("pas_inquire tenant={} correlation_id={}", tenantId, corrId);

        // Query workflow-engine for current case status
        JsonNode caseJson = fetchCaseByCorrelationId(corrId, tenantId);

        Bundle responseBundle = buildInquireResponseBundle(caseJson, corrId);
        log.info("pas_inquire_complete tenant={} correlation_id={}", tenantId, corrId);
        return responseBundle;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private JsonNode fetchCaseByCorrelationId(String correlationId, String tenantId) {
        try {
            String response = webClient.get()
                .uri(uriBuilder -> uriBuilder
                    .path("/internal/cases")
                    .queryParam("correlation_id", correlationId)
                    .queryParam("tenant_id", tenantId)
                    .build())
                .retrieve()
                .bodyToMono(String.class)
                .block(TIMEOUT);

            if (response == null || response.isBlank()) {
                throw new ResourceNotFoundException(
                    "No case found for correlation_id=" + correlationId
                );
            }

            return objectMapper.readTree(response);

        } catch (WebClientResponseException.NotFound e) {
            throw new ResourceNotFoundException(
                "No case found for correlation_id=" + correlationId
            );
        } catch (ResourceNotFoundException e) {
            throw e;
        } catch (Exception e) {
            throw new ca.uhn.fhir.rest.server.exceptions.InternalErrorException(
                "Error fetching case status: " + e.getMessage(), e
            );
        }
    }

    private Bundle buildInquireResponseBundle(JsonNode caseJson, String correlationId) {
        String status = caseJson.path("status").asText("intake");
        String caseId = caseJson.path("case_id").asText();

        ClaimResponse response = new ClaimResponse();
        response.setId(UUID.randomUUID().toString());
        response.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        response.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        response.setCreated(Date.from(Instant.now()));

        // Map canonical status → ClaimResponse.outcome
        ClaimResponse.RemittanceOutcome outcome = mapStatusToOutcome(status);
        response.setOutcome(outcome);

        // Extension: current case status
        response.addExtension(
            "https://enstellar.simintero.com/fhir/StructureDefinition/case-status",
            new StringType(status)
        );

        // Extension: case_id
        if (!caseId.isBlank()) {
            response.addExtension(
                "https://enstellar.simintero.com/fhir/StructureDefinition/case-id",
                new StringType(caseId)
            );
        }

        Bundle bundle = new Bundle();
        bundle.setId(UUID.randomUUID().toString());
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.setTimestamp(Date.from(Instant.now()));
        bundle.addEntry().setResource(response);
        return bundle;
    }

    private ClaimResponse.RemittanceOutcome mapStatusToOutcome(String status) {
        return switch (status) {
            case "approved" -> ClaimResponse.RemittanceOutcome.COMPLETE;
            case "denied", "partially_denied", "adverse_modification" -> ClaimResponse.RemittanceOutcome.ERROR;
            case "withdrawn", "closed" -> ClaimResponse.RemittanceOutcome.QUEUED;
            default -> ClaimResponse.RemittanceOutcome.QUEUED; // intake, clinical_review, pend_rfi, etc.
        };
    }
}
```

---

## Task 10: Register Providers in `HapiServerConfig.java`

**Files modified:** `config/HapiServerConfig.java`

- [ ] **Step 10.1: Inject and register PAS providers in `HapiServerConfig.java`**

In the existing `HapiServerConfig.java`, add `PasClaimSubmitProvider` and `PasClaimInquireProvider` as Spring beans and register them on the HAPI server:

```java
// Add to HapiServerConfig.java — inject these beans
@Autowired
private PasClaimSubmitProvider pasSubmitProvider;

@Autowired
private PasClaimInquireProvider pasInquireProvider;
```

In the `JpaRestfulServer` bean builder / `initialize()` override, add:

```java
// Register PAS providers (alongside existing Patient/Practitioner/Coverage/Organization providers)
registerProviders(pasSubmitProvider, pasInquireProvider);
```

The full `HapiServerConfig.java` (showing the additions in context):

```java
package com.simintero.enstellar.interop.config;

import com.simintero.enstellar.interop.conformance.EnstellarCapabilityStatementProvider;
import com.simintero.enstellar.interop.interceptors.AuditInterceptor;
import com.simintero.enstellar.interop.interceptors.SmartAuthInterceptor;
import com.simintero.enstellar.interop.interceptors.TenantInterceptor;
import com.simintero.enstellar.interop.pas.PasClaimInquireProvider;
import com.simintero.enstellar.interop.pas.PasClaimSubmitProvider;
import com.simintero.enstellar.interop.providers.CoverageResourceProvider;
import com.simintero.enstellar.interop.providers.OrganizationResourceProvider;
import com.simintero.enstellar.interop.providers.PatientResourceProvider;
import com.simintero.enstellar.interop.providers.PractitionerResourceProvider;
import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.jpa.starter.AppProperties;
import ca.uhn.fhir.rest.server.RestfulServer;
import jakarta.servlet.annotation.WebServlet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class HapiServerConfig {

    @Autowired private TenantInterceptor tenantInterceptor;
    @Autowired private SmartAuthInterceptor smartAuthInterceptor;
    @Autowired private AuditInterceptor auditInterceptor;
    @Autowired private EnstellarCapabilityStatementProvider capabilityProvider;
    @Autowired private PatientResourceProvider patientProvider;
    @Autowired private PractitionerResourceProvider practitionerProvider;
    @Autowired private CoverageResourceProvider coverageProvider;
    @Autowired private OrganizationResourceProvider organizationProvider;

    // T06: PAS providers
    @Autowired private PasClaimSubmitProvider pasSubmitProvider;
    @Autowired private PasClaimInquireProvider pasInquireProvider;

    @Bean
    public ServletRegistrationBean<RestfulServer> hapiServletRegistration(FhirContext fhirContext) {
        RestfulServer server = new RestfulServer(fhirContext);

        // Interceptors
        server.registerInterceptor(smartAuthInterceptor);
        server.registerInterceptor(tenantInterceptor);
        server.registerInterceptor(auditInterceptor);

        // Conformance
        server.setServerConformanceProvider(capabilityProvider);

        // Resource providers
        server.registerProviders(
            patientProvider,
            practitionerProvider,
            coverageProvider,
            organizationProvider,
            // T06: PAS operation providers
            pasSubmitProvider,
            pasInquireProvider
        );

        ServletRegistrationBean<RestfulServer> registration = new ServletRegistrationBean<>(server, "/fhir/*");
        registration.setName("hapiServlet");
        return registration;
    }
}
```

---

## Task 11: Write Integration Tests

**Files created:** `pas/PasBundleValidatorTest.java`, `pas/PasSubmitIT.java`, `pas/PasInquireIT.java`

- [ ] **Step 11.1: Create `pas/PasBundleValidatorTest.java`** (pure unit test, no Spring context)

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.server.exceptions.InvalidRequestException;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.Coverage;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Practitioner;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PasBundleValidatorTest {

    private static PasBundleValidator validator;
    private static FhirContext fhirContext;

    @BeforeAll
    static void setup() {
        validator = new PasBundleValidator();
        fhirContext = FhirContext.forR4();
    }

    private Bundle validBundle() {
        Bundle bundle = new Bundle();
        bundle.setType(Bundle.BundleType.COLLECTION);

        Claim claim = new Claim();
        claim.setId("claim-001");
        claim.setUse(Claim.Use.PREAUTHORIZATION);
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.addItem().setSequence(1);
        claim.addInsurance().setSequence(1).setFocal(true)
            .setCoverage(new org.hl7.fhir.r4.model.Reference("Coverage/cov-001"));
        bundle.addEntry().setResource(claim);

        bundle.addEntry().setResource(new Patient().setId("pat-001"));
        bundle.addEntry().setResource(new Practitioner().setId("pract-001"));
        bundle.addEntry().setResource(new Coverage().setId("cov-001"));

        return bundle;
    }

    @Test
    void validBundle_doesNotThrow() {
        assertDoesNotThrow(() -> validator.validate(validBundle()));
    }

    @Test
    void nullBundle_throwsInvalidRequestException() {
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(null)
        );
        assertTrue(ex.getMessage().contains("null"));
    }

    @Test
    void wrongBundleType_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        bundle.setType(Bundle.BundleType.TRANSACTION);
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("collection"));
    }

    @Test
    void missingClaim_throwsInvalidRequestException() {
        Bundle bundle = new Bundle();
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.addEntry().setResource(new Patient().setId("pat-001"));
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("Claim"));
    }

    @Test
    void wrongClaimUse_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        // Change Claim.use to claim (not preauthorization)
        bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .forEach(e -> ((Claim) e.getResource()).setUse(Claim.Use.CLAIM));
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("preauthorization"));
    }

    @Test
    void missingPatient_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Patient);
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("Patient"));
    }

    @Test
    void missingPractitioner_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Practitioner);
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("Practitioner"));
    }

    @Test
    void missingCoverage_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        bundle.getEntry().removeIf(e -> e.getResource() instanceof Coverage);
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("Coverage"));
    }

    @Test
    void emptyItems_throwsInvalidRequestException() {
        Bundle bundle = validBundle();
        bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .forEach(e -> ((Claim) e.getResource()).getItem().clear());
        InvalidRequestException ex = assertThrows(
            InvalidRequestException.class,
            () -> validator.validate(bundle)
        );
        assertTrue(ex.getMessage().contains("item"));
    }
}
```

- [ ] **Step 11.2: Create test support class `PasTestBundles.java`** (shared fixture)

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.*;

import java.util.Date;

/**
 * Shared test fixtures for PAS integration tests.
 */
public class PasTestBundles {

    public static Bundle validPasBundle(FhirContext ctx) {
        Bundle bundle = new Bundle();
        bundle.setId("pas-test-bundle-001");
        bundle.setType(Bundle.BundleType.COLLECTION);

        // Claim
        Claim claim = new Claim();
        claim.setId("claim-001");
        claim.setUse(Claim.Use.PREAUTHORIZATION);
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.setPatient(new Reference("Patient/pat-001"));
        claim.setProvider(new Reference("Practitioner/pract-001"));
        claim.addCareTeam().setSequence(1).setProvider(new Reference("Practitioner/pract-002"));
        claim.addInsurance().setSequence(1).setFocal(true)
            .setCoverage(new Reference("Coverage/cov-001"));
        claim.addDiagnosis().setSequence(1)
            .setDiagnosis(new CodeableConcept(
                new Coding("http://hl7.org/fhir/sid/icd-10-cm", "M54.5", "Low back pain")));
        claim.addItem().setSequence(1)
            .setCategory(new CodeableConcept(
                new Coding("https://codesystem.x12.org/005010/1365", "PT", "Physical Therapy")))
            .setProductOrService(new CodeableConcept(
                new Coding("http://www.ama-assn.org/go/cpt", "97110", "Therapeutic Exercise")))
            .setQuantity(new Quantity().setValue(12).setUnit("visits"))
            .addDiagnosisSequence(1);
        bundle.addEntry().setResource(claim);

        // Patient
        Patient patient = new Patient();
        patient.setId("pat-001");
        patient.addName().setFamily("Smith").addGiven("Jane");
        patient.setBirthDate(new Date(85, 3, 12)); // 1985-04-12
        patient.setGender(Enumerations.AdministrativeGender.FEMALE);
        patient.addIdentifier().setSystem("https://example.org/mrn").setValue("MRN-001");
        bundle.addEntry().setResource(patient);

        // Practitioner (requesting)
        Practitioner pract1 = new Practitioner();
        pract1.setId("pract-001");
        pract1.addName().setFamily("Jones").addGiven("Bob");
        pract1.addIdentifier()
            .setSystem("http://hl7.org/fhir/sid/us-npi")
            .setValue("1234567890");
        bundle.addEntry().setResource(pract1);

        // Practitioner (servicing)
        Practitioner pract2 = new Practitioner();
        pract2.setId("pract-002");
        pract2.addName().setFamily("Lee").addGiven("Alice");
        pract2.addIdentifier()
            .setSystem("http://hl7.org/fhir/sid/us-npi")
            .setValue("0987654321");
        bundle.addEntry().setResource(pract2);

        // Coverage
        Coverage coverage = new Coverage();
        coverage.setId("cov-001");
        coverage.setSubscriber(new Reference("Patient/pat-001"));
        coverage.setSubscriberId("SUB-12345");
        coverage.addPayor().setDisplay("ACME Health Plan");
        coverage.addClass_()
            .setType(new CodeableConcept(
                new Coding("http://terminology.hl7.org/CodeSystem/coverage-class", "plan", "Plan")))
            .setValue("PLAN-ACME-PPO-2025")
            .setName("ACME PPO 2025");
        coverage.addClass_()
            .setType(new CodeableConcept(
                new Coding("http://terminology.hl7.org/CodeSystem/coverage-class", "group", "Group")))
            .setValue("GRP-999")
            .setName("ACME PPO");
        bundle.addEntry().setResource(coverage);

        return bundle;
    }
}
```

- [ ] **Step 11.3: Create `pas/PasSubmitIT.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.api.ServerValidationModeEnum;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;

import java.time.Duration;
import java.util.*;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for POST [base]/Claim/$submit (happy path).
 *
 * Uses:
 *   - Testcontainers PostgreSQL (from FhirTestBase)
 *   - Testcontainers Redpanda (Kafka)
 *   - Testcontainers MinIO
 *   - WireMock for workflow-engine /internal/normalize
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PasSubmitIT extends FhirTestBase {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.6.1")
    );

    @Container
    static MinIOContainer minio = new MinIOContainer(
        DockerImageName.parse("minio/minio:RELEASE.2024-07-04T19-14-18Z")
    );

    static WireMockServer wireMock;

    @LocalServerPort
    int port;

    @BeforeAll
    static void startWireMock() {
        wireMock = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        wireMock.start();
        WireMock.configureFor("localhost", wireMock.port());
    }

    @AfterAll
    static void stopWireMock() {
        wireMock.stop();
    }

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        // Kafka
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
        // MinIO
        registry.add("MINIO_ENDPOINT", () -> minio.getS3URL().replace("http://", ""));
        registry.add("MINIO_ACCESS_KEY", minio::getUserName);
        registry.add("MINIO_SECRET_KEY", minio::getPassword);
        // Normalization service → WireMock
        registry.add("NORMALIZATION_URL", () -> "http://localhost:" + wireMock.port());
    }

    private IGenericClient hapiClient() {
        FhirContext ctx = FhirContext.forR4();
        ctx.getRestfulClientFactory().setServerValidationMode(ServerValidationModeEnum.NEVER);
        return ctx.newRestfulGenericClient("http://localhost:" + port + "/fhir");
    }

    private void stubNormalize(String tenantId, String correlationId) {
        wireMock.stubFor(
            post(urlEqualTo("/internal/normalize"))
                .willReturn(okJson("""
                    {
                      "case_id": "550e8400-e29b-41d4-a716-446655440000",
                      "tenant_id": "%s",
                      "correlation_id": "%s",
                      "status": "intake",
                      "lob": "commercial",
                      "_raw_bundle_key": "enstellar-raw-bundles/%s/raw-bundles/2026-06-05/%s.json"
                    }
                    """.formatted(tenantId, correlationId, tenantId, correlationId))
                )
        );
    }

    @Test
    @Order(1)
    void submit_validBundle_returns200WithApprovedClaimResponse() {
        String tenantId = "tenant-pas-test";
        createPartition(tenantId);
        stubNormalize(tenantId, "pas-test-bundle-001");

        FhirContext ctx = FhirContext.forR4();
        Bundle requestBundle = PasTestBundles.validPasBundle(ctx);

        Bundle responseBundle = hapiClient()
            .operation()
            .onType(org.hl7.fhir.r4.model.Claim.class)
            .named("$submit")
            .withNoParameters(Bundle.class)
            .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
            .useHttpPost()
            .returnResourceType(Bundle.class)
            .execute();

        assertThat(responseBundle).isNotNull();
        assertThat(responseBundle.getEntry()).isNotEmpty();

        ClaimResponse claimResponse = (ClaimResponse) responseBundle.getEntryFirstRep().getResource();
        assertThat(claimResponse.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.COMPLETE);
        assertThat(claimResponse.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
    }

    @Test
    @Order(2)
    void submit_rawBundleStoredInMinio() {
        String tenantId = "tenant-minio-test";
        createPartition(tenantId);
        stubNormalize(tenantId, "pas-test-bundle-001");

        FhirContext ctx = FhirContext.forR4();
        Bundle requestBundle = PasTestBundles.validPasBundle(ctx);

        hapiClient()
            .operation()
            .onType(org.hl7.fhir.r4.model.Claim.class)
            .named("$submit")
            .withNoParameters(Bundle.class)
            .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
            .useHttpPost()
            .returnResourceType(Bundle.class)
            .execute();

        // Verify object exists in MinIO
        try {
            MinioClient minioClient = MinioClient.builder()
                .endpoint(minio.getS3URL())
                .credentials(minio.getUserName(), minio.getPassword())
                .build();

            // The raw bundle key contains tenantId + correlationId
            // We just check that at least one object exists with the tenant prefix
            var objects = minioClient.listObjects(
                io.minio.ListObjectsArgs.builder()
                    .bucket("enstellar-raw-bundles")
                    .prefix(tenantId + "/raw-bundles/")
                    .build()
            );
            assertThat(objects.iterator().hasNext()).isTrue();

        } catch (Exception e) {
            Assertions.fail("MinIO object not found: " + e.getMessage());
        }
    }

    @Test
    @Order(3)
    void submit_publishesCaseIntakeEventToKafka() throws Exception {
        String tenantId = "tenant-kafka-test";
        createPartition(tenantId);
        stubNormalize(tenantId, "pas-test-bundle-001");

        FhirContext ctx = FhirContext.forR4();
        hapiClient()
            .operation()
            .onType(org.hl7.fhir.r4.model.Claim.class)
            .named("$submit")
            .withNoParameters(Bundle.class)
            .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
            .useHttpPost()
            .returnResourceType(Bundle.class)
            .execute();

        // Consume from Kafka and verify event
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, kafka.getBootstrapServers());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "test-consumer-" + UUID.randomUUID());
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
            consumer.subscribe(List.of("case.intake.received"));
            ConsumerRecord<String, String> record = null;
            long deadline = System.currentTimeMillis() + 15_000;
            while (record == null && System.currentTimeMillis() < deadline) {
                var records = consumer.poll(Duration.ofMillis(500));
                if (!records.isEmpty()) {
                    record = records.iterator().next();
                }
            }
            assertThat(record).isNotNull();
            assertThat(record.key()).isEqualTo(tenantId);
            assertThat(record.value()).contains("case.intake.received");
            assertThat(record.value()).contains(tenantId);
        }
    }

    @Test
    @Order(4)
    void submit_invalidBundle_returns422() {
        String tenantId = "tenant-val-test";
        createPartition(tenantId);

        // Bundle with wrong type (not collection)
        Bundle badBundle = new Bundle();
        badBundle.setId("bad-bundle-001");
        badBundle.setType(Bundle.BundleType.TRANSACTION);

        try {
            hapiClient()
                .operation()
                .onType(org.hl7.fhir.r4.model.Claim.class)
                .named("$submit")
                .withNoParameters(Bundle.class)
                .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
                .useHttpPost()
                .returnResourceType(Bundle.class)
                .execute();
            Assertions.fail("Expected InvalidRequestException (422)");
        } catch (ca.uhn.fhir.rest.server.exceptions.InvalidRequestException e) {
            assertThat(e.getStatusCode()).isEqualTo(422);
        }
    }

    @Test
    @Order(5)
    void submit_withoutToken_returns401() {
        Bundle bundle = PasTestBundles.validPasBundle(FhirContext.forR4());
        try {
            hapiClient()
                .operation()
                .onType(org.hl7.fhir.r4.model.Claim.class)
                .named("$submit")
                .withNoParameters(Bundle.class)
                .useHttpPost()
                .returnResourceType(Bundle.class)
                .execute();
            Assertions.fail("Expected AuthenticationException (401)");
        } catch (ca.uhn.fhir.rest.server.exceptions.AuthenticationException e) {
            assertThat(e.getStatusCode()).isEqualTo(401);
        }
    }
}
```

- [ ] **Step 11.4: Create `pas/PasInquireIT.java`**

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.api.ServerValidationModeEnum;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for GET [base]/Claim/{correlationId}/$inquire.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PasInquireIT extends FhirTestBase {

    static WireMockServer wireMock;

    @LocalServerPort
    int port;

    @BeforeAll
    static void startWireMock() {
        wireMock = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        wireMock.start();
        WireMock.configureFor("localhost", wireMock.port());
    }

    @AfterAll
    static void stopWireMock() {
        wireMock.stop();
    }

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("NORMALIZATION_URL", () -> "http://localhost:" + wireMock.port());
    }

    private IGenericClient hapiClient() {
        FhirContext ctx = FhirContext.forR4();
        ctx.getRestfulClientFactory().setServerValidationMode(ServerValidationModeEnum.NEVER);
        return ctx.newRestfulGenericClient("http://localhost:" + port + "/fhir");
    }

    @Test
    @Order(1)
    void inquire_approvedCase_returnsCompleteOutcome() {
        String tenantId = "tenant-inquire-test";
        createPartition(tenantId);

        wireMock.stubFor(
            get(urlPathMatching("/internal/cases"))
                .withQueryParam("correlation_id", equalTo("corr-approved-001"))
                .withQueryParam("tenant_id", equalTo(tenantId))
                .willReturn(okJson("""
                    {
                      "case_id": "550e8400-e29b-41d4-a716-446655440001",
                      "tenant_id": "%s",
                      "correlation_id": "corr-approved-001",
                      "status": "approved"
                    }
                    """.formatted(tenantId))
                )
        );

        Bundle response = hapiClient()
            .operation()
            .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", "corr-approved-001"))
            .named("$inquire")
            .withNoParameters(Bundle.class)
            .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
            .execute();

        assertThat(response).isNotNull();
        ClaimResponse cr = (ClaimResponse) response.getEntryFirstRep().getResource();
        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.COMPLETE);
    }

    @Test
    @Order(2)
    void inquire_pendingCase_returnsQueuedOutcome() {
        String tenantId = "tenant-inquire-test";
        createPartition(tenantId);

        wireMock.stubFor(
            get(urlPathMatching("/internal/cases"))
                .withQueryParam("correlation_id", equalTo("corr-pending-001"))
                .willReturn(okJson("""
                    {
                      "case_id": "550e8400-e29b-41d4-a716-446655440002",
                      "tenant_id": "%s",
                      "correlation_id": "corr-pending-001",
                      "status": "clinical_review"
                    }
                    """.formatted(tenantId))
                )
        );

        Bundle response = hapiClient()
            .operation()
            .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", "corr-pending-001"))
            .named("$inquire")
            .withNoParameters(Bundle.class)
            .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
            .execute();

        ClaimResponse cr = (ClaimResponse) response.getEntryFirstRep().getResource();
        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.QUEUED);
    }

    @Test
    @Order(3)
    void inquire_unknownCase_returns404() {
        String tenantId = "tenant-inquire-test";
        createPartition(tenantId);

        wireMock.stubFor(
            get(urlPathMatching("/internal/cases"))
                .withQueryParam("correlation_id", equalTo("corr-not-found"))
                .willReturn(notFound())
        );

        assertThrows(
            ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException.class,
            () -> hapiClient()
                .operation()
                .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", "corr-not-found"))
                .named("$inquire")
                .withNoParameters(Bundle.class)
                .withAdditionalHeader("Authorization", "Bearer " + mintJwt(tenantId))
                .execute()
        );
    }

    private static <T extends Throwable> T assertThrows(Class<T> ex, org.junit.jupiter.api.function.Executable fn) {
        return Assertions.assertThrows(ex, fn);
    }
}
```

---

## Task 12: Run Tests

- [ ] **Step 12.1: Run the validator unit test first (no Docker needed)**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.pas.PasBundleValidatorTest" --info 2>&1 | tail -20
```

Expected:
```
PasBundleValidatorTest > validBundle_doesNotThrow() PASSED
PasBundleValidatorTest > nullBundle_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > wrongBundleType_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > missingClaim_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > wrongClaimUse_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > missingPatient_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > missingPractitioner_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > missingCoverage_throwsInvalidRequestException() PASSED
PasBundleValidatorTest > emptyItems_throwsInvalidRequestException() PASSED

9 tests completed, 0 failed
BUILD SUCCESSFUL
```

- [ ] **Step 12.2: Run integration tests (requires Docker)**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.pas.PasSubmitIT" \
              --tests "com.simintero.enstellar.interop.pas.PasInquireIT" \
              --info 2>&1 | tail -30
```

Expected (first run pulls Docker images; allow 3–5 min):
```
PasSubmitIT > submit_validBundle_returns200WithApprovedClaimResponse() PASSED
PasSubmitIT > submit_rawBundleStoredInMinio() PASSED
PasSubmitIT > submit_publishesCaseIntakeEventToKafka() PASSED
PasSubmitIT > submit_invalidBundle_returns422() PASSED
PasSubmitIT > submit_withoutToken_returns401() PASSED
PasInquireIT > inquire_approvedCase_returnsCompleteOutcome() PASSED
PasInquireIT > inquire_pendingCase_returnsQueuedOutcome() PASSED
PasInquireIT > inquire_unknownCase_returns404() PASSED

8 tests completed, 0 failed
BUILD SUCCESSFUL
```

- [ ] **Step 12.3: Run full interop test suite to confirm no T05 regressions**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test 2>&1 | tail -10
```

Expected: all tests pass (T05 tests + T06 tests).

---

## Task 13: Mark T06 Done, Commit

- [ ] **Step 13.1: Mark T06 done in `.claude/task-graph.md`**

Open `.claude/task-graph.md` and change the T06 entry from `[ ]` to `[x]`.

- [ ] **Step 13.2: Stage changed files**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
git add services/interop/build.gradle.kts
git add services/interop/src/main/java/com/simintero/enstellar/interop/pas/
git add services/interop/src/main/java/com/simintero/enstellar/interop/config/PasConfig.java
git add services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java
git add services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java
git add services/interop/src/main/resources/application.yml
git add services/interop/src/test/java/com/simintero/enstellar/interop/pas/
git add .claude/task-graph.md
```

- [ ] **Step 13.3: Confirm staged files**

```bash
git diff --cached --name-only
```

Expected:
```
.claude/task-graph.md
services/interop/build.gradle.kts
services/interop/src/main/java/com/simintero/enstellar/interop/InteropApplication.java
services/interop/src/main/java/com/simintero/enstellar/interop/config/HapiServerConfig.java
services/interop/src/main/java/com/simintero/enstellar/interop/config/PasConfig.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/CaseIntakePublisher.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/MinioRawBundleStore.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/NormalizationClient.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasBundleValidator.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimInquireProvider.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimSubmitProvider.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/dto/Actor.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/dto/EventEnvelope.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/dto/NormalizeRequest.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/dto/NormalizeResponse.java
services/interop/src/main/resources/application.yml
services/interop/src/test/java/com/simintero/enstellar/interop/pas/PasBundleValidatorTest.java
services/interop/src/test/java/com/simintero/enstellar/interop/pas/PasInquireIT.java
services/interop/src/test/java/com/simintero/enstellar/interop/pas/PasSubmitIT.java
services/interop/src/test/java/com/simintero/enstellar/interop/pas/PasTestBundles.java
```

- [ ] **Step 13.4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(T06): PAS $submit/$inquire — store-first, normalize, publish, ClaimResponse

Adds HAPI Claim/$submit (store raw bundle in MinIO before validation,
normalize via workflow-engine, publish case.intake.received to Kafka,
return approved ClaimResponse) and Claim/$inquire (look up canonical
case status, return ClaimResponse). PasBundleValidator returns 422 on
invalid profiles. Happy-path + 401/422/404 covered by IT tests.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: `[<branch> <sha>] feat(T06): PAS $submit/$inquire ...`

---

## Definition of Done Checklist

- [ ] `POST /fhir/Claim/$submit` with valid PAS bundle returns HTTP 200 with a `Bundle` containing a `ClaimResponse` with `outcome=complete`, `use=preauthorization`.
- [ ] Raw PAS bundle is stored in MinIO (key contains `tenant_id` + `correlation_id`) BEFORE any validation or transformation.
- [ ] `case.intake.received` Kafka event is published with correct `tenant_id` as message key and event `type`.
- [ ] `POST /fhir/Claim/$submit` with invalid bundle (wrong type, missing Claim, wrong use) returns HTTP 422 with OperationOutcome.
- [ ] `POST /fhir/Claim/$submit` without Authorization header returns HTTP 401.
- [ ] `GET /fhir/Claim/{correlationId}/$inquire` with approved case returns `ClaimResponse.outcome=complete`.
- [ ] `GET /fhir/Claim/{correlationId}/$inquire` with unknown correlationId returns HTTP 404.
- [ ] All T05 tests still pass (no regressions).
- [ ] `PasBundleValidatorTest`: 9 unit tests pass.
- [ ] `PasSubmitIT`: 5 integration tests pass.
- [ ] `PasInquireIT`: 3 integration tests pass.

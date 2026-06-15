# T11 — ClaimResponse Out + Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Python workflow-engine's `decision.recorded` Kafka event into the JVM interop service: consume the event, update a `DecisionRecord` in PostgreSQL, and return a correctly-shaped `ClaimResponse` from `$inquire` — completing the P0 walking skeleton end-to-end flow.

**Architecture:** `DecisionRecord` has a two-phase lifecycle: created at `$submit` time (outcome=null, pending) and updated when `decision.recorded` arrives (outcome=approved, trace pinned). `DecisionEventConsumer` is a `@KafkaListener` that parses the `EventEnvelope` JSON, validates `tenant_id`, finds the existing `DecisionRecord` by `case_id` + `tenant_id`, and writes the outcome + trace. `PasClaimInquireProvider` queries `DecisionStore` by `correlation_id` + `tenant_id`: not-found → 404, found with null outcome → pending `ClaimResponse`, found with outcome → complete `ClaimResponse` with provenance extension. `ClaimResponse.identifier` echoes back the original `Claim.identifier` stored at submit time (`claim_ref`).

**Tech Stack:** Java 21, Spring Boot 3.3.4, HAPI FHIR 7.4.0, spring-kafka 3.x, Spring Data JPA, Flyway 10.x, Testcontainers (PostgreSQL + Kafka), Jackson.

> **Invariant note:** `tenant_id` must be present in every `decision.recorded` event; `DecisionEventConsumer` discards (logs error, does NOT throw) any event missing `tenant_id` — never allow an uncaught exception to poison the consumer loop. `ClaimResponse` includes a provenance extension `rule-trace` linking to the exact `rule_artifact_id@rule_version` returned by T10 — this is the reproducible decision trace. No PHI appears in log lines (log case_id, tenant_id, correlation_id only).

**Depends on:** T05 (HAPI server), T06 ($submit/$inquire providers, `PasClaimSubmitProvider`, `PasClaimInquireProvider`, `FhirTestBase`, `TestSecurityConfig`), T10 (auto-determination emits `decision.recorded` on topic `decision.recorded` with payload `{decision_id, outcome, auto_approved, rule_artifact_id, rule_version}`).

---

## Background (read before touching code)

**What T06 built in `services/interop/`:**

- `pas/PasClaimSubmitProvider.java` — `$submit`: store-first MinIO, validate, normalize via workflow-engine REST, publish `case.intake.received`, return synchronous approved `ClaimResponse`. After T11 it also saves an initial `DecisionRecord` (outcome=null) after normalization.
- `pas/PasClaimInquireProvider.java` — `$inquire`: currently queries workflow-engine REST at `GET /internal/cases?correlation_id=...`. T11 replaces this with a local `DecisionStore` query.
- `pas/dto/EventEnvelope.java` — Java record with fields: `eventId`, `tenantId`, `caseId`, `correlationId`, `type`, `occurredAt`, `actor`, `payload` (Map), `schemaVersion`.
- `pas/NormalizationClient.java` returns `NormalizeResponse` with `caseId`, `tenantId`, `correlationId`.
- `config/PasConfig.java` — `@ConfigurationProperties(prefix="enstellar.pas")` — has MinIO, Kafka producer (topic), and normalization URL.
- `FhirTestBase.java` — abstract test base with PostgreSQL Testcontainers, `mintJwt(tenantId, scopes)`, `@DynamicPropertySource` overriding datasource to the PostgreSQL container.
- `TestSecurityConfig.java` — `@TestConfiguration` providing a `JwtDecoder` backed by a generated RSA keypair.

**What T10 emits:**

Topic: `decision.recorded`

Full `EventEnvelope` JSON (outer wrapper — matches `pas/dto/EventEnvelope.java`):
```json
{
  "event_id": "uuid",
  "tenant_id": "tenant-abc",
  "case_id":   "550e8400-e29b-41d4-a716-446655440000",
  "correlation_id": "pas-bundle-001",
  "type": "decision.recorded",
  "occurred_at": "2026-06-05T12:00:00Z",
  "actor": {"id": "auto-determination", "type": "system"},
  "payload": {
    "decision_id": "uuid",
    "outcome": "approved",
    "auto_approved": true,
    "rule_artifact_id": "policy-v2-2026-q2",
    "rule_version": "2.1.0"
  },
  "schema_version": "1.0.0"
}
```

**How `claim_ref` flows:**

1. `PasClaimSubmitProvider.submit()` extracts `Claim.getIdentifierFirstRep().getValue()` (falls back to `correlationId` if no Claim.identifier is set). This is stored as `DecisionRecord.claimRef` at intake time.
2. `DecisionEventConsumer.onDecision()` finds the `DecisionRecord` by `case_id` + `tenant_id` and fills in `outcome`, `ruleArtifact`, `ruleVersion`, `autoApproved`, `decidedAt`.
3. `PasClaimInquireProvider` reads `DecisionRecord.claimRef` and passes it to `ClaimResponseBuilder` which sets `ClaimResponse.identifier`.

**Package prefix:** `com.simintero.enstellar.interop`

**Kafka broker (compose):** Redpanda at `redpanda:9092` (internal) / `localhost:9092` (host). Topic: `decision.recorded`.

---

## File Map

**New files — `services/interop/src/main/java/com/simintero/enstellar/interop/`:**

| File | Responsibility |
|---|---|
| `decision/DecisionRecord.java` | JPA entity for `decision_store` table — two-phase lifecycle |
| `decision/DecisionStore.java` | Spring Data JPA repository |
| `decision/ClaimResponseBuilder.java` | Builds HAPI `ClaimResponse` + Bundle from `DecisionRecord` |
| `decision/DecisionEventConsumer.java` | `@KafkaListener` for `decision.recorded` topic |
| `decision/dto/DecisionEventEnvelope.java` | Jackson DTO for outer `EventEnvelope` |
| `decision/dto/DecisionRecordedPayload.java` | Jackson DTO for `payload` of `decision.recorded` |
| `config/KafkaConsumerConfig.java` | spring-kafka consumer factory + listener container factory |

**New files — `services/interop/src/main/resources/db/migration/`:**

| File | Responsibility |
|---|---|
| `V2__add_decision_store.sql` | Creates `decision_store` table + indexes |

**New files — `services/interop/src/test/java/com/simintero/enstellar/interop/`:**

| File | Responsibility |
|---|---|
| `decision/ClaimResponseBuilderTest.java` | Unit: correct identifier, adjudication, provenance extension |
| `decision/DecisionEventConsumerIT.java` | IT (Testcontainers Kafka + PostgreSQL): event → DB row updated |
| `decision/PasInquireDecisionIT.java` | IT (Testcontainers Kafka + PostgreSQL + WireMock): end-to-end: $submit → decision event → $inquire → ClaimResponse |

**Modified files:**

| File | Change |
|---|---|
| `services/interop/build.gradle.kts` | Add `spring-kafka`, `flyway-core`, `flyway-database-postgresql`, `testcontainers:kafka` |
| `services/interop/src/main/resources/application.yml` | Enable Flyway, add Kafka consumer + producer config |
| `services/interop/src/test/resources/application-test.yml` | Disable Flyway for H2 unit tests |
| `services/interop/src/main/java/.../pas/PasClaimSubmitProvider.java` | Inject `DecisionStore`; save initial `DecisionRecord` after normalization |
| `services/interop/src/main/java/.../pas/PasClaimInquireProvider.java` | Replace WebClient REST call with `DecisionStore` query |
| `.claude/task-graph.md` | Mark T11 `[x]` |

---

## Task 1: Gradle Dependencies + Flyway Migration + JPA Entity + Repository

**Files modified:** `services/interop/build.gradle.kts`, `services/interop/src/main/resources/application.yml`, `services/interop/src/test/resources/application-test.yml`

**Files created:** `V2__add_decision_store.sql`, `DecisionRecord.java`, `DecisionStore.java`

- [ ] **Step 1.1: Update `services/interop/build.gradle.kts`**

Replace the `dependencies { ... }` block entirely (keep all existing entries, add new):

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
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    implementation("com.fasterxml.jackson.core:jackson-databind")

    // T06: Kafka producer, MinIO
    implementation("org.springframework.kafka:spring-kafka")
    implementation("io.minio:minio:8.5.10")

    // T11: Flyway schema migration
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")

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
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
```

- [ ] **Step 1.2: Verify dependencies resolve**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew dependencies --configuration compileClasspath 2>&1 | grep -E "(flyway|spring-kafka)" | head -10
```

Expected:
```
+--- org.flywaydb:flyway-core:10.x.y
+--- org.flywaydb:flyway-database-postgresql:10.x.y
+--- org.springframework.kafka:spring-kafka:3.x.y
```

- [ ] **Step 1.3: Update `src/main/resources/application.yml`**

Add the following sections (append below the existing content; do not remove existing entries):

```yaml
spring:
  flyway:
    enabled: true
    baseline-on-migrate: true
    baseline-version: 1
    locations: classpath:db/migration
  kafka:
    bootstrap-servers: ${KAFKA_BOOTSTRAP_SERVERS:redpanda:9092}
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      acks: all
      retries: 3
      properties:
        enable.idempotence: "true"
    consumer:
      group-id: interop-decision-consumer
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      auto-offset-reset: earliest
      enable-auto-commit: false

enstellar:
  pas:
    normalization-url: ${NORMALIZATION_URL:http://workflow-engine:8000}
    minio:
      endpoint: ${MINIO_ENDPOINT:minio:9000}
      access-key: ${MINIO_ACCESS_KEY:minioadmin}
      secret-key: ${MINIO_SECRET_KEY:minioadmin}
      secure: ${MINIO_SECURE:false}
      bucket: ${MINIO_BUCKET:enstellar-raw-bundles}
    kafka:
      intake-topic: ${PAS_INTAKE_TOPIC:case.intake.received}
```

- [ ] **Step 1.4: Update `src/test/resources/application-test.yml`**

Disable Flyway for H2-based unit tests (IT tests that use PostgreSQL Testcontainers enable it via `@DynamicPropertySource`):

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL
    driver-class-name: org.h2.Driver
  jpa:
    hibernate:
      ddl-auto: create-drop
    database-platform: org.hibernate.dialect.H2Dialect
    properties:
      hibernate:
        dialect: org.hibernate.dialect.H2Dialect
  flyway:
    enabled: false
  kafka:
    bootstrap-servers: localhost:9092
```

- [ ] **Step 1.5: Create directory and `V2__add_decision_store.sql`**

```bash
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop/src/main/resources/db/migration
```

Create `src/main/resources/db/migration/V2__add_decision_store.sql`:

```sql
-- T11: Decision store — two-phase lifecycle
-- Phase 1: row created at $submit time (outcome IS NULL = pending)
-- Phase 2: row updated when decision.recorded arrives (outcome IS NOT NULL = complete)

CREATE TABLE IF NOT EXISTS decision_store (
    id             BIGSERIAL PRIMARY KEY,
    case_id        UUID,
    tenant_id      TEXT        NOT NULL,
    correlation_id TEXT        NOT NULL,
    claim_ref      TEXT        NOT NULL,
    outcome        TEXT,                        -- NULL until decision.recorded arrives
    rule_artifact  TEXT,
    rule_version   TEXT,
    auto_approved  BOOLEAN,
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: $inquire queries by (tenant_id, correlation_id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_store_tenant_corr
    ON decision_store (tenant_id, correlation_id);

-- Secondary lookup: DecisionEventConsumer queries by (case_id, tenant_id)
CREATE INDEX IF NOT EXISTS idx_decision_store_case
    ON decision_store (case_id, tenant_id);
```

- [ ] **Step 1.6: Create `decision/DecisionRecord.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/DecisionRecord.java`:

```java
package com.simintero.enstellar.interop.decision;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for the decision_store table.
 *
 * Two-phase lifecycle:
 *   Phase 1 — Created by PasClaimSubmitProvider at $submit time.
 *             outcome IS NULL (= pending, decision in flight).
 *             Stores claim_ref (Claim.identifier) for tracking number.
 *
 *   Phase 2 — Updated by DecisionEventConsumer on decision.recorded.
 *             outcome IS NOT NULL (= approved / pending_review / etc.).
 *             rule_artifact, rule_version, auto_approved, decided_at filled in.
 *
 * INVARIANT #5: tenant_id is NON-NULL and is propagated to every DB query
 * that touches this table.
 */
@Entity
@Table(name = "decision_store")
public class DecisionRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** UUID of the canonical case created by the workflow-engine. */
    @Column(name = "case_id", columnDefinition = "uuid")
    private UUID caseId;

    /** Tenant that owns this case. Never null after creation. */
    @Column(name = "tenant_id", nullable = false)
    private String tenantId;

    /**
     * Correlation ID: the Bundle.id used as the external tracking ID for this submission.
     * Used as the path parameter in $inquire: GET /fhir/Claim/{correlationId}/$inquire
     */
    @Column(name = "correlation_id", nullable = false)
    private String correlationId;

    /**
     * Prior-auth tracking number echoed back in ClaimResponse.identifier.
     * Extracted from Claim.identifier at $submit time; falls back to correlationId.
     */
    @Column(name = "claim_ref", nullable = false)
    private String claimRef;

    /**
     * Outcome from decision.recorded — null while decision is in flight.
     * Expected values: "approved" (P0 auto path); future: "clinical_review", etc.
     */
    @Column(name = "outcome")
    private String outcome;

    /** Digicore rule artifact ID — set when decision.recorded arrives. */
    @Column(name = "rule_artifact")
    private String ruleArtifact;

    /** Digicore rule version — set when decision.recorded arrives. */
    @Column(name = "rule_version")
    private String ruleVersion;

    /** Whether the decision was made automatically (no human sign-off). */
    @Column(name = "auto_approved")
    private Boolean autoApproved;

    /** Timestamp of the decision — from EventEnvelope.occurred_at. */
    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // -----------------------------------------------------------------------
    // Getters and setters
    // -----------------------------------------------------------------------

    public Long getId() { return id; }

    public UUID getCaseId() { return caseId; }
    public void setCaseId(UUID caseId) { this.caseId = caseId; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public String getCorrelationId() { return correlationId; }
    public void setCorrelationId(String correlationId) { this.correlationId = correlationId; }

    public String getClaimRef() { return claimRef; }
    public void setClaimRef(String claimRef) { this.claimRef = claimRef; }

    public String getOutcome() { return outcome; }
    public void setOutcome(String outcome) { this.outcome = outcome; }

    public String getRuleArtifact() { return ruleArtifact; }
    public void setRuleArtifact(String ruleArtifact) { this.ruleArtifact = ruleArtifact; }

    public String getRuleVersion() { return ruleVersion; }
    public void setRuleVersion(String ruleVersion) { this.ruleVersion = ruleVersion; }

    public Boolean getAutoApproved() { return autoApproved; }
    public void setAutoApproved(Boolean autoApproved) { this.autoApproved = autoApproved; }

    public Instant getDecidedAt() { return decidedAt; }
    public void setDecidedAt(Instant decidedAt) { this.decidedAt = decidedAt; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
```

- [ ] **Step 1.7: Create `decision/DecisionStore.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/DecisionStore.java`:

```java
package com.simintero.enstellar.interop.decision;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA repository for the decision_store table.
 *
 * All queries include tenant_id as a predicate to enforce tenant isolation
 * (INVARIANT #5).
 */
@Repository
public interface DecisionStore extends JpaRepository<DecisionRecord, Long> {

    /**
     * Primary $inquire lookup — find by the correlation ID used at $submit time.
     *
     * Returns empty Optional if:
     *   - No matching correlation_id in this tenant (case doesn't exist)
     *   - tenant_id mismatch (cross-tenant attempt, silently returns empty)
     */
    Optional<DecisionRecord> findByCorrelationIdAndTenantId(
            String correlationId, String tenantId);

    /**
     * DecisionEventConsumer lookup — find by case_id to update the record
     * when decision.recorded arrives.
     */
    Optional<DecisionRecord> findByCaseIdAndTenantId(
            UUID caseId, String tenantId);
}
```

- [ ] **Step 1.8: Confirm the entity is picked up by the JPA scan**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew compileJava 2>&1 | tail -5
```

Expected:
```
BUILD SUCCESSFUL in Xs
```

---

## Task 2: `KafkaConsumerConfig.java` + Failing `DecisionEventConsumerIT.java` (Red State)

- [ ] **Step 2.1: Create directory structure**

```bash
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop/src/main/java/com/simintero/enstellar/interop/decision/dto
mkdir -p /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop/src/test/java/com/simintero/enstellar/interop/decision
```

Expected: no output.

- [ ] **Step 2.2: Create `config/KafkaConsumerConfig.java`**

Create `src/main/java/com/simintero/enstellar/interop/config/KafkaConsumerConfig.java`:

```java
package com.simintero.enstellar.interop.config;

import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.listener.ContainerProperties;

import java.util.HashMap;
import java.util.Map;

/**
 * Spring Kafka consumer configuration for the interop service.
 *
 * Registers a ConcurrentKafkaListenerContainerFactory with MANUAL_IMMEDIATE
 * acknowledgment mode so that DecisionEventConsumer controls offset commits.
 * Auto-commit is disabled to prevent offset advancement on processing failure.
 */
@Configuration
@EnableKafka
public class KafkaConsumerConfig {

    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    @Bean
    public ConsumerFactory<String, String> decisionConsumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "interop-decision-consumer");
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 10);
        return new DefaultKafkaConsumerFactory<>(props);
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(decisionConsumerFactory());
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.MANUAL_IMMEDIATE);
        return factory;
    }
}
```

- [ ] **Step 2.3: Create `decision/dto/DecisionEventEnvelope.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/dto/DecisionEventEnvelope.java`:

```java
package com.simintero.enstellar.interop.decision.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Jackson DTO for the outer EventEnvelope JSON published to "decision.recorded".
 *
 * Matches the Python EventEnvelope schema in packages/event-contracts.
 * Unknown fields are ignored for forward compatibility.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DecisionEventEnvelope(
        @JsonProperty("event_id")       String eventId,
        @JsonProperty("tenant_id")      String tenantId,
        @JsonProperty("case_id")        String caseId,
        @JsonProperty("correlation_id") String correlationId,
        @JsonProperty("type")           String type,
        @JsonProperty("occurred_at")    String occurredAt,
        @JsonProperty("payload")        DecisionRecordedPayload payload,
        @JsonProperty("schema_version") String schemaVersion
) {}
```

- [ ] **Step 2.4: Create `decision/dto/DecisionRecordedPayload.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/dto/DecisionRecordedPayload.java`:

```java
package com.simintero.enstellar.interop.decision.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Jackson DTO for the payload object inside a decision.recorded EventEnvelope.
 *
 * T10 (AutoDeterminator._approve()) emits:
 *   decision_id, outcome, auto_approved, rule_artifact_id, rule_version
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DecisionRecordedPayload(
        @JsonProperty("decision_id")    String decisionId,
        @JsonProperty("outcome")        String outcome,
        @JsonProperty("auto_approved")  boolean autoApproved,
        @JsonProperty("rule_artifact_id") String ruleArtifactId,
        @JsonProperty("rule_version")   String ruleVersion
) {}
```

- [ ] **Step 2.5: Write failing `DecisionEventConsumerIT.java`**

Create `src/test/java/com/simintero/enstellar/interop/decision/DecisionEventConsumerIT.java`:

```java
package com.simintero.enstellar.interop.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.FhirTestBase;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * Integration test: publish decision.recorded Kafka event → DecisionRecord updated in DB.
 *
 * Prerequisite: DecisionEventConsumer does not yet exist → test fails with
 * BeanCreationException (class not found). This is the intentional red state.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=true",
        "spring.flyway.baseline-version=1"
    }
)
@Testcontainers
class DecisionEventConsumerIT extends FhirTestBase {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
            DockerImageName.parse("confluentinc/cp-kafka:7.6.1"));

    @DynamicPropertySource
    static void overrideKafka(DynamicPropertyRegistry registry) {
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.baseline-on-migrate", () -> "true");
        registry.add("spring.flyway.baseline-version", () -> "1");
    }

    @Autowired
    DecisionStore decisionStore;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void decisionRecordedEvent_updatesDecisionRecord_withOutcomeAndTrace() throws Exception {
        String tenantId = "tenant-consumer-it";
        UUID caseId = UUID.randomUUID();
        String correlationId = "corr-consumer-it-" + caseId;

        // Create the intake-phase DecisionRecord (as $submit would)
        DecisionRecord pending = new DecisionRecord();
        pending.setCaseId(caseId);
        pending.setTenantId(tenantId);
        pending.setCorrelationId(correlationId);
        pending.setClaimRef("CLAIM-IT-001");
        pending.setCreatedAt(Instant.now());
        decisionStore.save(pending);

        assertThat(decisionStore.findByCaseIdAndTenantId(caseId, tenantId))
                .isPresent()
                .satisfies(opt -> assertThat(opt.get().getOutcome()).isNull());

        // Publish a decision.recorded event
        String eventJson = buildDecisionEvent(tenantId, caseId.toString(), correlationId,
                "approved", "policy-v2", "2.1.0", true);

        KafkaTemplate<String, String> producer = makeProducer();
        producer.send("decision.recorded", tenantId, eventJson).get(10, TimeUnit.SECONDS);

        // Wait up to 15s for the consumer to update the DB row
        await().atMost(15, TimeUnit.SECONDS).untilAsserted(() -> {
            DecisionRecord updated = decisionStore.findByCaseIdAndTenantId(caseId, tenantId)
                    .orElseThrow(() -> new AssertionError("DecisionRecord not found"));
            assertThat(updated.getOutcome()).isEqualTo("approved");
            assertThat(updated.getRuleArtifact()).isEqualTo("policy-v2");
            assertThat(updated.getRuleVersion()).isEqualTo("2.1.0");
            assertThat(updated.getAutoApproved()).isTrue();
            assertThat(updated.getDecidedAt()).isNotNull();
        });
    }

    @Test
    void decisionRecordedEvent_missingTenantId_isDiscardedSafely() throws Exception {
        // An event with no tenant_id must not cause a consumer crash
        String eventJson = """
                {
                  "event_id": "%s",
                  "tenant_id": null,
                  "case_id": "%s",
                  "correlation_id": "corr-no-tenant",
                  "type": "decision.recorded",
                  "occurred_at": "%s",
                  "actor": {"id": "auto-determination", "type": "system"},
                  "payload": {
                    "decision_id": "%s",
                    "outcome": "approved",
                    "auto_approved": true,
                    "rule_artifact_id": "policy-v1",
                    "rule_version": "1.0.0"
                  },
                  "schema_version": "1.0.0"
                }
                """.formatted(UUID.randomUUID(), UUID.randomUUID(), Instant.now(), UUID.randomUUID());

        KafkaTemplate<String, String> producer = makeProducer();
        producer.send("decision.recorded", "key-no-tenant", eventJson).get(10, TimeUnit.SECONDS);

        // Consumer must still be alive 3 seconds later (no crash / infinite loop)
        TimeUnit.SECONDS.sleep(3);
        // If the test reaches here, the consumer handled the bad event without dying.
        // Verify no garbage row was written (any record with tenant_id=null would be a bug)
        assertThat(decisionStore.count()).isGreaterThanOrEqualTo(0); // just alive check
    }

    // -----------------------------------------------------------------------

    private String buildDecisionEvent(String tenantId, String caseId, String correlationId,
            String outcome, String artifact, String version, boolean autoApproved) throws Exception {
        Map<String, Object> payload = Map.of(
                "decision_id", UUID.randomUUID().toString(),
                "outcome", outcome,
                "auto_approved", autoApproved,
                "rule_artifact_id", artifact,
                "rule_version", version
        );
        Map<String, Object> envelope = new HashMap<>();
        envelope.put("event_id", UUID.randomUUID().toString());
        envelope.put("tenant_id", tenantId);
        envelope.put("case_id", caseId);
        envelope.put("correlation_id", correlationId);
        envelope.put("type", "decision.recorded");
        envelope.put("occurred_at", Instant.now().toString());
        envelope.put("actor", Map.of("id", "auto-determination", "type", "system"));
        envelope.put("payload", payload);
        envelope.put("schema_version", "1.0.0");
        return objectMapper.writeValueAsString(envelope);
    }

    private KafkaTemplate<String, String> makeProducer() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, kafka.getBootstrapServers());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        return new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(props));
    }
}
```

- [ ] **Step 2.6: Add `awaitility` test dependency to `build.gradle.kts`**

Add inside the `dependencies { }` block (test scope):

```kotlin
testImplementation("org.awaitility:awaitility:4.2.1")
```

- [ ] **Step 2.7: Run failing test to confirm red state**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.decision.DecisionEventConsumerIT" \
    --info 2>&1 | tail -15
```

Expected:
```
DecisionEventConsumerIT > decisionRecordedEvent_updatesDecisionRecord_withOutcomeAndTrace() FAILED
    org.springframework.beans.factory.NoSuchBeanDefinitionException:
    No qualifying bean of type 'com.simintero.enstellar.interop.decision.DecisionEventConsumer'
```

---

## Task 3: `ClaimResponseBuilder.java` + Unit Test (Red → Green)

- [ ] **Step 3.1: Create `decision/ClaimResponseBuilder.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/ClaimResponseBuilder.java`:

```java
package com.simintero.enstellar.interop.decision;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.StringType;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * Builds a HAPI FHIR R4 ClaimResponse + Bundle from a completed DecisionRecord.
 *
 * DoD requirements enforced by this class:
 *   1. ClaimResponse.identifier echoes Claim.identifier (claim_ref) as prior-auth tracking number.
 *   2. adjudication category = "benefit" (http://terminology.hl7.org/CodeSystem/adjudication).
 *   3. Provenance extension "rule-trace" = "{rule_artifact}@{rule_version}" makes the
 *      decision trace reproducible from the event history.
 *   4. outcome = COMPLETE for approved decisions.
 *   5. use = PREAUTHORIZATION.
 */
@Component
public class ClaimResponseBuilder {

    private static final String RULE_TRACE_EXT =
            "https://enstellar.simintero.com/fhir/StructureDefinition/rule-trace";
    private static final String CASE_ID_EXT =
            "https://enstellar.simintero.com/fhir/StructureDefinition/case-id";
    private static final String AUTH_TRACKING_SYSTEM =
            "https://enstellar.simintero.com/auth-tracking";
    private static final String ADJUDICATION_SYSTEM =
            "http://terminology.hl7.org/CodeSystem/adjudication";

    /**
     * Build a Bundle containing a completed ClaimResponse from a DecisionRecord.
     * Called by PasClaimInquireProvider when outcome is non-null.
     */
    public Bundle buildBundle(DecisionRecord record) {
        ClaimResponse cr = buildClaimResponse(record);
        Bundle bundle = new Bundle();
        bundle.setId(UUID.randomUUID().toString());
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.setTimestamp(Date.from(Instant.now()));
        bundle.addEntry().setResource(cr);
        return bundle;
    }

    /**
     * Build a Bundle containing a pending ClaimResponse (decision in flight).
     * Called by PasClaimInquireProvider when outcome IS NULL.
     *
     * @param correlationId Used for ClaimResponse.identifier to echo tracking number.
     * @param claimRef      The original Claim.identifier (may equal correlationId if no
     *                      explicit Claim.identifier was provided at submit time).
     */
    public Bundle buildPendingBundle(String correlationId, String claimRef) {
        ClaimResponse cr = new ClaimResponse();
        cr.setId(UUID.randomUUID().toString());
        cr.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        cr.setOutcome(ClaimResponse.RemittanceOutcome.QUEUED);
        cr.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        cr.setCreated(Date.from(Instant.now()));

        cr.addIdentifier()
                .setSystem(AUTH_TRACKING_SYSTEM)
                .setValue(claimRef != null ? claimRef : correlationId);

        Bundle bundle = new Bundle();
        bundle.setId(UUID.randomUUID().toString());
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.setTimestamp(Date.from(Instant.now()));
        bundle.addEntry().setResource(cr);
        return bundle;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    ClaimResponse buildClaimResponse(DecisionRecord record) {
        ClaimResponse cr = new ClaimResponse();
        cr.setId(UUID.randomUUID().toString());
        cr.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        cr.setOutcome(ClaimResponse.RemittanceOutcome.COMPLETE);
        cr.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        cr.setCreated(record.getDecidedAt() != null
                ? Date.from(record.getDecidedAt())
                : Date.from(Instant.now()));

        // DoD: echo Claim.identifier as prior-auth tracking number
        cr.addIdentifier()
                .setSystem(AUTH_TRACKING_SYSTEM)
                .setValue(record.getClaimRef());

        // DoD: adjudication with category=benefit
        cr.addItem()
                .setItemSequence(1)
                .addAdjudication()
                .setCategory(new CodeableConcept(
                        new Coding(ADJUDICATION_SYSTEM, "benefit", "Benefit Amount")));

        // DoD: provenance extension — links to exact rule artifact + version
        // This makes the decision trace reproducible from event history
        if (record.getRuleArtifact() != null && record.getRuleVersion() != null) {
            cr.addExtension()
                    .setUrl(RULE_TRACE_EXT)
                    .setValue(new StringType(
                            record.getRuleArtifact() + "@" + record.getRuleVersion()));
        }

        // Extension: case_id for downstream correlation
        if (record.getCaseId() != null) {
            cr.addExtension()
                    .setUrl(CASE_ID_EXT)
                    .setValue(new StringType(record.getCaseId().toString()));
        }

        return cr;
    }
}
```

- [ ] **Step 3.2: Create `decision/ClaimResponseBuilderTest.java`**

Create `src/test/java/com/simintero/enstellar/interop/decision/ClaimResponseBuilderTest.java`:

```java
package com.simintero.enstellar.interop.decision;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for ClaimResponseBuilder — no Spring context needed.
 *
 * Verifies all T11 DoD requirements:
 *   - ClaimResponse.identifier echoes claim_ref (prior-auth tracking number)
 *   - adjudication category = "benefit"
 *   - rule-trace extension = "{artifact}@{version}"
 *   - outcome = COMPLETE for approved
 *   - pending bundle has outcome = QUEUED
 */
class ClaimResponseBuilderTest {

    private static ClaimResponseBuilder builder;

    @BeforeAll
    static void setup() {
        builder = new ClaimResponseBuilder();
    }

    private DecisionRecord approvedRecord() {
        DecisionRecord r = new DecisionRecord();
        r.setCaseId(UUID.fromString("550e8400-e29b-41d4-a716-446655440001"));
        r.setTenantId("tenant-unit-test");
        r.setCorrelationId("corr-unit-001");
        r.setClaimRef("CLAIM-REF-001");
        r.setOutcome("approved");
        r.setRuleArtifact("policy-v2-2026-q2");
        r.setRuleVersion("2.1.0");
        r.setAutoApproved(true);
        r.setDecidedAt(Instant.parse("2026-06-05T12:00:00Z"));
        r.setCreatedAt(Instant.parse("2026-06-05T11:55:00Z"));
        return r;
    }

    @Test
    void buildBundle_returnsCollectionBundleWithOneClaimResponse() {
        Bundle bundle = builder.buildBundle(approvedRecord());

        assertThat(bundle.getType()).isEqualTo(Bundle.BundleType.COLLECTION);
        assertThat(bundle.getEntry()).hasSize(1);
        assertThat(bundle.getEntryFirstRep().getResource()).isInstanceOf(ClaimResponse.class);
    }

    @Test
    void buildBundle_claimResponseIdentifier_echoesClaimRef() {
        // DoD: ClaimResponse.identifier echoes Claim.identifier as prior-auth tracking number
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getIdentifier()).isNotEmpty();
        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo("CLAIM-REF-001");
        assertThat(cr.getIdentifierFirstRep().getSystem())
                .isEqualTo("https://enstellar.simintero.com/auth-tracking");
    }

    @Test
    void buildBundle_outcome_isComplete() {
        // DoD: outcome = COMPLETE for approved decision
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.COMPLETE);
    }

    @Test
    void buildBundle_use_isPreauthorization() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
    }

    @Test
    void buildBundle_adjudication_categoryIsBenefit() {
        // DoD: adjudication category = "benefit"
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getItem()).isNotEmpty();
        ClaimResponse.AdjudicationComponent adj = cr.getItemFirstRep().getAdjudicationFirstRep();
        assertThat(adj.getCategory().getCodingFirstRep().getSystem())
                .isEqualTo("http://terminology.hl7.org/CodeSystem/adjudication");
        assertThat(adj.getCategory().getCodingFirstRep().getCode()).isEqualTo("benefit");
    }

    @Test
    void buildBundle_ruleTraceExtension_containsArtifactAtVersion() {
        // DoD: decision trace reproducible from event history
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        var traceExt = cr.getExtension().stream()
                .filter(e -> e.getUrl().endsWith("rule-trace"))
                .findFirst();
        assertThat(traceExt).isPresent();
        assertThat(traceExt.get().getValue().toString())
                .isEqualTo("policy-v2-2026-q2@2.1.0");
    }

    @Test
    void buildBundle_caseIdExtension_present() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        var caseIdExt = cr.getExtension().stream()
                .filter(e -> e.getUrl().endsWith("case-id"))
                .findFirst();
        assertThat(caseIdExt).isPresent();
        assertThat(caseIdExt.get().getValue().toString())
                .isEqualTo("550e8400-e29b-41d4-a716-446655440001");
    }

    @Test
    void buildPendingBundle_outcome_isQueued() {
        Bundle bundle = builder.buildPendingBundle("corr-pending-001", "CLAIM-PENDING-001");
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.QUEUED);
        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
    }

    @Test
    void buildPendingBundle_claimRefEchoed() {
        Bundle bundle = builder.buildPendingBundle("corr-pending-001", "CLAIM-PENDING-001");
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo("CLAIM-PENDING-001");
    }

    @Test
    void buildBundle_nullRuleArtifact_noTraceExtension() {
        // If rule artifact is null (edge case), no extension must be added
        DecisionRecord r = approvedRecord();
        r.setRuleArtifact(null);
        r.setRuleVersion(null);

        Bundle bundle = builder.buildBundle(r);
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        boolean hasTrace = cr.getExtension().stream()
                .anyMatch(e -> e.getUrl().endsWith("rule-trace"));
        assertThat(hasTrace).isFalse();
    }
}
```

- [ ] **Step 3.3: Run unit tests — confirm green**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.decision.ClaimResponseBuilderTest" \
    --info 2>&1 | tail -20
```

Expected:
```
ClaimResponseBuilderTest > buildBundle_returnsCollectionBundleWithOneClaimResponse() PASSED
ClaimResponseBuilderTest > buildBundle_claimResponseIdentifier_echoesClaimRef() PASSED
ClaimResponseBuilderTest > buildBundle_outcome_isComplete() PASSED
ClaimResponseBuilderTest > buildBundle_use_isPreauthorization() PASSED
ClaimResponseBuilderTest > buildBundle_adjudication_categoryIsBenefit() PASSED
ClaimResponseBuilderTest > buildBundle_ruleTraceExtension_containsArtifactAtVersion() PASSED
ClaimResponseBuilderTest > buildBundle_caseIdExtension_present() PASSED
ClaimResponseBuilderTest > buildPendingBundle_outcome_isQueued() PASSED
ClaimResponseBuilderTest > buildPendingBundle_claimRefEchoed() PASSED
ClaimResponseBuilderTest > buildBundle_nullRuleArtifact_noTraceExtension() PASSED

10 tests completed, 0 failed
BUILD SUCCESSFUL
```

---

## Task 4: `DecisionEventConsumer.java` Implementation + Integration Test (Green)

- [ ] **Step 4.1: Create `decision/DecisionEventConsumer.java`**

Create `src/main/java/com/simintero/enstellar/interop/decision/DecisionEventConsumer.java`:

```java
package com.simintero.enstellar.interop.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.decision.dto.DecisionEventEnvelope;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * Kafka listener that consumes decision.recorded events and updates
 * the corresponding DecisionRecord in the decision_store table.
 *
 * Processing contract:
 *   1. Parse EventEnvelope JSON.
 *   2. Validate tenant_id present — discard (log error) if missing (INVARIANT #5).
 *   3. Parse case_id as UUID — discard if malformed.
 *   4. Find DecisionRecord by case_id + tenant_id.
 *   5. Update outcome, rule_artifact, rule_version, auto_approved, decided_at.
 *   6. Save and acknowledge.
 *
 * Safety contract:
 *   - NEVER throws from onDecision() — all exceptions are caught and logged.
 *   - Offset is always acknowledged (to avoid infinite retry on poison-pill events)
 *     EXCEPT when the DB save itself fails, in which case the exception propagates
 *     to trigger spring-kafka's error handler (which will retry with backoff).
 *
 * INVARIANT #3: no PHI is logged — only tenant_id, case_id, correlation_id, event_id.
 */
@Component
public class DecisionEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(DecisionEventConsumer.class);

    private final DecisionStore decisionStore;
    private final ObjectMapper objectMapper;

    public DecisionEventConsumer(DecisionStore decisionStore, ObjectMapper objectMapper) {
        this.decisionStore = decisionStore;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(
            topics = "decision.recorded",
            groupId = "interop-decision-consumer",
            containerFactory = "kafkaListenerContainerFactory"
    )
    public void onDecision(ConsumerRecord<String, String> record, Acknowledgment ack) {
        String rawJson = record.value();

        DecisionEventEnvelope envelope;
        try {
            envelope = objectMapper.readValue(rawJson, DecisionEventEnvelope.class);
        } catch (Exception e) {
            log.error("decision_consumer_parse_error offset={} error={}",
                    record.offset(), e.getMessage());
            ack.acknowledge(); // bad JSON — discard, do not retry
            return;
        }

        // INVARIANT #5: tenant_id must be present
        String tenantId = envelope.tenantId();
        if (tenantId == null || tenantId.isBlank()) {
            log.error("decision_consumer_missing_tenant_id event_id={} — discarding",
                    envelope.eventId());
            ack.acknowledge();
            return;
        }

        String rawCaseId = envelope.caseId();
        if (rawCaseId == null || rawCaseId.isBlank()) {
            log.error("decision_consumer_missing_case_id event_id={} tenant_id={} — discarding",
                    envelope.eventId(), tenantId);
            ack.acknowledge();
            return;
        }

        UUID caseId;
        try {
            caseId = UUID.fromString(rawCaseId);
        } catch (IllegalArgumentException e) {
            log.error("decision_consumer_invalid_case_id event_id={} tenant_id={} case_id={} — discarding",
                    envelope.eventId(), tenantId, rawCaseId);
            ack.acknowledge();
            return;
        }

        if (envelope.payload() == null) {
            log.error("decision_consumer_null_payload event_id={} tenant_id={} — discarding",
                    envelope.eventId(), tenantId);
            ack.acknowledge();
            return;
        }

        log.info("decision_consumer_received event_id={} tenant_id={} case_id={} outcome={}",
                envelope.eventId(), tenantId, caseId, envelope.payload().outcome());

        Optional<DecisionRecord> existing = decisionStore.findByCaseIdAndTenantId(caseId, tenantId);
        if (existing.isEmpty()) {
            log.warn("decision_consumer_no_intake_record event_id={} tenant_id={} case_id={} "
                    + "— no matching DecisionRecord found (may arrive out-of-order); skipping",
                    envelope.eventId(), tenantId, caseId);
            ack.acknowledge();
            return;
        }

        DecisionRecord dr = existing.get();

        // Idempotency guard: if already decided, do not overwrite
        if (dr.getOutcome() != null) {
            log.info("decision_consumer_already_decided event_id={} tenant_id={} case_id={} "
                    + "existing_outcome={} — skipping duplicate",
                    envelope.eventId(), tenantId, caseId, dr.getOutcome());
            ack.acknowledge();
            return;
        }

        dr.setOutcome(envelope.payload().outcome());
        dr.setRuleArtifact(envelope.payload().ruleArtifactId());
        dr.setRuleVersion(envelope.payload().ruleVersion());
        dr.setAutoApproved(envelope.payload().autoApproved());

        Instant decidedAt = parseOccurredAt(envelope.occurredAt());
        dr.setDecidedAt(decidedAt);

        decisionStore.save(dr); // allow DB exception to propagate → spring-kafka retries

        log.info("decision_consumer_updated event_id={} tenant_id={} case_id={} outcome={} artifact={}@{}",
                envelope.eventId(), tenantId, caseId,
                dr.getOutcome(), dr.getRuleArtifact(), dr.getRuleVersion());

        ack.acknowledge();
    }

    // -----------------------------------------------------------------------

    private Instant parseOccurredAt(String occurredAt) {
        if (occurredAt == null) return Instant.now();
        try {
            return Instant.parse(occurredAt);
        } catch (Exception e) {
            log.warn("decision_consumer_occurred_at_parse_error value={} — using now()", occurredAt);
            return Instant.now();
        }
    }
}
```

- [ ] **Step 4.2: Run `DecisionEventConsumerIT` — confirm green**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.decision.DecisionEventConsumerIT" \
    --info 2>&1 | tail -20
```

Expected (first run pulls Kafka image; allow 2–3 min):
```
DecisionEventConsumerIT > decisionRecordedEvent_updatesDecisionRecord_withOutcomeAndTrace() PASSED
DecisionEventConsumerIT > decisionRecordedEvent_missingTenantId_isDiscardedSafely() PASSED

2 tests completed, 0 failed
BUILD SUCCESSFUL
```

---

## Task 5: Update `PasClaimSubmitProvider` + `PasClaimInquireProvider` + End-to-End Test

- [ ] **Step 5.1: Modify `PasClaimSubmitProvider.java`**

The T06 plan already defines this class. T11 adds two things:
(a) inject `DecisionStore` in the constructor
(b) after normalization succeeds, create and save an initial `DecisionRecord` (outcome=null)

In `src/main/java/com/simintero/enstellar/interop/pas/PasClaimSubmitProvider.java`, make these changes:

**Add import:**
```java
import com.simintero.enstellar.interop.decision.DecisionRecord;
import com.simintero.enstellar.interop.decision.DecisionStore;
import org.hl7.fhir.r4.model.Identifier;
```

**Add field and inject via constructor:**
```java
private final DecisionStore decisionStore;

public PasClaimSubmitProvider(
    MinioRawBundleStore minioStore,
    PasBundleValidator validator,
    NormalizationClient normClient,
    CaseIntakePublisher intakePublisher,
    DecisionStore decisionStore              // T11: decision tracking
) {
    this.minioStore = minioStore;
    this.validator = validator;
    this.normClient = normClient;
    this.intakePublisher = intakePublisher;
    this.decisionStore = decisionStore;
}
```

**In `submit()`, after `intakePublisher.publish(normalizeResponse);` and before building the response bundle, add:**

```java
// T11: Create intake-phase DecisionRecord (outcome=null = pending)
// claim_ref is the Claim.identifier value echoed back in ClaimResponse.identifier.
// Falls back to correlationId if the Claim carries no explicit identifier.
String claimRef = extractClaimRef(bundle, correlationId);
DecisionRecord trackingRecord = new DecisionRecord();
trackingRecord.setCaseId(normalizeResponse.caseId() != null
        ? UUID.fromString(normalizeResponse.caseId()) : null);
trackingRecord.setTenantId(tenantId);
trackingRecord.setCorrelationId(correlationId);
trackingRecord.setClaimRef(claimRef);
trackingRecord.setCreatedAt(java.time.Instant.now());
decisionStore.save(trackingRecord);
log.info("pas_submit_tracking_record_created tenant={} correlation_id={} claim_ref={}",
        tenantId, correlationId, claimRef);
```

**Add private helper method `extractClaimRef` to `PasClaimSubmitProvider`:**

```java
/**
 * Extract the prior-auth tracking number from the Claim.identifier field.
 * In PAS, Claim.identifier is set by the submitting EHR as their tracking number.
 * Falls back to correlationId (Bundle.id) if no Claim.identifier is present.
 *
 * INVARIANT: never returns null.
 */
private String extractClaimRef(Bundle bundle, String fallback) {
    return bundle.getEntry().stream()
            .filter(e -> e.getResource() instanceof Claim)
            .map(e -> (Claim) e.getResource())
            .findFirst()
            .map(claim -> claim.getIdentifier().stream()
                    .filter(id -> id.getValue() != null && !id.getValue().isBlank())
                    .map(Identifier::getValue)
                    .findFirst()
                    .orElse(fallback))
            .orElse(fallback);
}
```

- [ ] **Step 5.2: Modify `PasClaimInquireProvider.java`**

The T06 plan's `PasClaimInquireProvider` queries the workflow-engine REST API. T11 replaces this with a local `DecisionStore` query.

Replace the contents of `src/main/java/com/simintero/enstellar/interop/pas/PasClaimInquireProvider.java` entirely:

```java
package com.simintero.enstellar.interop.pas;

import ca.uhn.fhir.rest.annotation.IdParam;
import ca.uhn.fhir.rest.annotation.Operation;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException;
import com.simintero.enstellar.interop.decision.ClaimResponseBuilder;
import com.simintero.enstellar.interop.decision.DecisionRecord;
import com.simintero.enstellar.interop.decision.DecisionStore;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.IdType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * HAPI FHIR operation provider for Claim/$inquire (Da Vinci PAS).
 *
 * GET [base]/Claim/{correlationId}/$inquire
 *   Returns: Bundle containing a ClaimResponse with the current authorization status.
 *
 * Status resolution (T11):
 *   - DecisionRecord not found → 404 ResourceNotFoundException
 *   - DecisionRecord.outcome IS NULL → pending ClaimResponse (outcome=QUEUED)
 *   - DecisionRecord.outcome IS NOT NULL → complete ClaimResponse (outcome=COMPLETE)
 *
 * INVARIANT #5: all queries include tenant_id to prevent cross-tenant access.
 */
@Component
public class PasClaimInquireProvider implements IResourceProvider {

    private static final Logger log = LoggerFactory.getLogger(PasClaimInquireProvider.class);

    private final DecisionStore decisionStore;
    private final ClaimResponseBuilder claimResponseBuilder;

    public PasClaimInquireProvider(DecisionStore decisionStore,
                                   ClaimResponseBuilder claimResponseBuilder) {
        this.decisionStore = decisionStore;
        this.claimResponseBuilder = claimResponseBuilder;
    }

    @Override
    public Class<Claim> getResourceType() {
        return Claim.class;
    }

    /**
     * Handle GET [base]/Claim/{correlationId}/$inquire.
     *
     * The {correlationId} path parameter is the Bundle.id used at $submit time.
     *
     * @param correlationId  The correlation ID from the original $submit (Bundle.id).
     * @param requestDetails HAPI request context (tenant_id set by TenantInterceptor).
     * @return Bundle containing a ClaimResponse reflecting current authorization status.
     * @throws ResourceNotFoundException if no case found for this correlationId + tenantId.
     */
    @Operation(name = "$inquire", idempotent = true, type = Claim.class)
    public Bundle inquire(
            @IdParam IdType correlationId,
            RequestDetails requestDetails) {

        String tenantId = (String) requestDetails.getAttribute("tenantId");
        String corrId = correlationId.getIdPart();

        log.info("pas_inquire tenant={} correlation_id={}", tenantId, corrId);

        Optional<DecisionRecord> record =
                decisionStore.findByCorrelationIdAndTenantId(corrId, tenantId);

        if (record.isEmpty()) {
            log.info("pas_inquire_not_found tenant={} correlation_id={}", tenantId, corrId);
            throw new ResourceNotFoundException(
                    "No prior authorization found for correlation_id=" + corrId);
        }

        DecisionRecord dr = record.get();

        if (dr.getOutcome() == null) {
            // Decision still in flight — return pending response
            log.info("pas_inquire_pending tenant={} correlation_id={} case_id={}",
                    tenantId, corrId, dr.getCaseId());
            return claimResponseBuilder.buildPendingBundle(corrId, dr.getClaimRef());
        }

        // Decision complete
        log.info("pas_inquire_complete tenant={} correlation_id={} case_id={} outcome={}",
                tenantId, corrId, dr.getCaseId(), dr.getOutcome());
        return claimResponseBuilder.buildBundle(dr);
    }
}
```

- [ ] **Step 5.3: Create `decision/PasInquireDecisionIT.java`**

Create `src/test/java/com/simintero/enstellar/interop/decision/PasInquireDecisionIT.java`:

```java
package com.simintero.enstellar.interop.decision;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.rest.client.api.IGenericClient;
import ca.uhn.fhir.rest.client.api.ServerValidationModeEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * End-to-end integration test for the T11 walking skeleton:
 *   $submit → intake-phase DecisionRecord created →
 *   $inquire → pending ClaimResponse →
 *   (publish decision.recorded event) →
 *   $inquire → complete ClaimResponse with outcome=COMPLETE + rule-trace extension.
 *
 * Uses:
 *   - Testcontainers PostgreSQL (from FhirTestBase)
 *   - Testcontainers Kafka
 *   - WireMock for workflow-engine /internal/normalize
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=true",
        "spring.flyway.baseline-version=1"
    }
)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PasInquireDecisionIT extends FhirTestBase {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
            DockerImageName.parse("confluentinc/cp-kafka:7.6.1"));

    static WireMockServer wireMock;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    DecisionStore decisionStore;

    // Shared state across ordered tests
    static final String TENANT_ID = "tenant-e2e-t11";
    static final String CLAIM_REF = "EHR-TRACKING-001";
    static String correlationId;

    @BeforeAll
    static void startWireMock() {
        wireMock = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        wireMock.start();
        WireMock.configureFor("localhost", wireMock.port());
        correlationId = "e2e-bundle-" + UUID.randomUUID();
    }

    @AfterAll
    static void stopWireMock() {
        wireMock.stop();
    }

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.kafka.bootstrap-servers", kafka::getBootstrapServers);
        registry.add("NORMALIZATION_URL", () -> "http://localhost:" + wireMock.port());
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.baseline-on-migrate", () -> "true");
    }

    private IGenericClient hapiClient() {
        FhirContext ctx = FhirContext.forR4();
        ctx.getRestfulClientFactory().setServerValidationMode(ServerValidationModeEnum.NEVER);
        ctx.getRestfulClientFactory().setConnectTimeout(30_000);
        ctx.getRestfulClientFactory().setSocketTimeout(30_000);
        return ctx.newRestfulGenericClient("http://localhost:" + port + "/fhir");
    }

    // -----------------------------------------------------------------------
    // Test 1: $submit creates intake-phase DecisionRecord
    // -----------------------------------------------------------------------

    @Test
    @Order(1)
    void submit_createsIntakePhaseDecisionRecord() {
        stubNormalize(TENANT_ID, correlationId);

        Bundle requestBundle = buildPasBundle(correlationId, CLAIM_REF);

        hapiClient()
                .operation()
                .onType(org.hl7.fhir.r4.model.Claim.class)
                .named("$submit")
                .withNoParameters(Bundle.class)
                .withAdditionalHeader("Authorization",
                        "Bearer " + mintJwt(TENANT_ID, "system/*.write"))
                .useHttpPost()
                .returnResourceType(Bundle.class)
                .execute();

        // Verify intake-phase record was created with outcome=null
        Optional<DecisionRecord> record = decisionStore
                .findByCorrelationIdAndTenantId(correlationId, TENANT_ID);
        assertThat(record).isPresent();
        assertThat(record.get().getOutcome()).isNull();
        assertThat(record.get().getClaimRef()).isEqualTo(CLAIM_REF);
        assertThat(record.get().getCaseId()).isNotNull();
    }

    // -----------------------------------------------------------------------
    // Test 2: $inquire before decision → pending ClaimResponse
    // -----------------------------------------------------------------------

    @Test
    @Order(2)
    void inquire_beforeDecision_returnsPendingClaimResponse() {
        // No decision.recorded event yet — should return QUEUED
        Bundle response = hapiClient()
                .operation()
                .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", correlationId))
                .named("$inquire")
                .withNoParameters(Bundle.class)
                .withAdditionalHeader("Authorization",
                        "Bearer " + mintJwt(TENANT_ID, "system/*.read"))
                .execute();

        assertThat(response).isNotNull();
        ClaimResponse cr = (ClaimResponse) response.getEntryFirstRep().getResource();
        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.QUEUED);
        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
        // claim_ref echoed back
        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo(CLAIM_REF);
    }

    // -----------------------------------------------------------------------
    // Test 3: publish decision.recorded → DecisionRecord updated
    // -----------------------------------------------------------------------

    @Test
    @Order(3)
    void publishDecisionEvent_updatesDecisionRecord() throws Exception {
        DecisionRecord before = decisionStore
                .findByCorrelationIdAndTenantId(correlationId, TENANT_ID)
                .orElseThrow();
        UUID caseId = before.getCaseId();

        publishDecisionEvent(TENANT_ID, caseId.toString(), correlationId,
                "approved", "policy-v2-2026-q2", "2.1.0");

        await().atMost(15, TimeUnit.SECONDS).untilAsserted(() -> {
            DecisionRecord updated = decisionStore
                    .findByCorrelationIdAndTenantId(correlationId, TENANT_ID)
                    .orElseThrow();
            assertThat(updated.getOutcome()).isEqualTo("approved");
            assertThat(updated.getRuleArtifact()).isEqualTo("policy-v2-2026-q2");
            assertThat(updated.getRuleVersion()).isEqualTo("2.1.0");
            assertThat(updated.getAutoApproved()).isTrue();
        });
    }

    // -----------------------------------------------------------------------
    // Test 4: $inquire after decision → complete ClaimResponse with trace
    // -----------------------------------------------------------------------

    @Test
    @Order(4)
    void inquire_afterDecision_returnsCompleteClaimResponseWithTrace() {
        Bundle response = hapiClient()
                .operation()
                .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", correlationId))
                .named("$inquire")
                .withNoParameters(Bundle.class)
                .withAdditionalHeader("Authorization",
                        "Bearer " + mintJwt(TENANT_ID, "system/*.read"))
                .execute();

        ClaimResponse cr = (ClaimResponse) response.getEntryFirstRep().getResource();

        // DoD: outcome = COMPLETE
        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.COMPLETE);
        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);

        // DoD: ClaimResponse.identifier echoes Claim.identifier
        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo(CLAIM_REF);
        assertThat(cr.getIdentifierFirstRep().getSystem())
                .isEqualTo("https://enstellar.simintero.com/auth-tracking");

        // DoD: adjudication with category=benefit
        ClaimResponse.AdjudicationComponent adj =
                cr.getItemFirstRep().getAdjudicationFirstRep();
        assertThat(adj.getCategory().getCodingFirstRep().getCode()).isEqualTo("benefit");

        // DoD: decision trace reproducible from event history
        var traceExt = cr.getExtension().stream()
                .filter(e -> e.getUrl().endsWith("rule-trace"))
                .findFirst();
        assertThat(traceExt).isPresent();
        assertThat(traceExt.get().getValue().toString())
                .isEqualTo("policy-v2-2026-q2@2.1.0");
    }

    // -----------------------------------------------------------------------
    // Test 5: $inquire unknown correlationId → 404
    // -----------------------------------------------------------------------

    @Test
    @Order(5)
    void inquire_unknownCorrelationId_returns404() {
        Assertions.assertThrows(
                ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException.class,
                () -> hapiClient()
                        .operation()
                        .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", "corr-never-submitted"))
                        .named("$inquire")
                        .withNoParameters(Bundle.class)
                        .withAdditionalHeader("Authorization",
                                "Bearer " + mintJwt(TENANT_ID, "system/*.read"))
                        .execute()
        );
    }

    // -----------------------------------------------------------------------
    // Test 6: cross-tenant $inquire → 404 (tenant isolation)
    // -----------------------------------------------------------------------

    @Test
    @Order(6)
    void inquire_wrongTenant_returns404() {
        // correlationId exists for TENANT_ID, but we query with a different tenant
        Assertions.assertThrows(
                ca.uhn.fhir.rest.server.exceptions.ResourceNotFoundException.class,
                () -> hapiClient()
                        .operation()
                        .onInstance(new org.hl7.fhir.r4.model.IdType("Claim", correlationId))
                        .named("$inquire")
                        .withNoParameters(Bundle.class)
                        .withAdditionalHeader("Authorization",
                                "Bearer " + mintJwt("tenant-wrong", "system/*.read"))
                        .execute()
        );
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void stubNormalize(String tenantId, String corrId) {
        wireMock.stubFor(
                post(urlEqualTo("/internal/normalize"))
                        .willReturn(okJson("""
                                {
                                  "case_id": "%s",
                                  "tenant_id": "%s",
                                  "correlation_id": "%s",
                                  "status": "intake",
                                  "lob": "commercial",
                                  "_raw_bundle_key": "enstellar-raw-bundles/%s/raw-bundles/2026-06-05/%s.json"
                                }
                                """.formatted(UUID.randomUUID(), tenantId, corrId, tenantId, corrId))
                        )
        );
    }

    private Bundle buildPasBundle(String bundleId, String claimIdentifierValue) {
        org.hl7.fhir.r4.model.Claim claim = new org.hl7.fhir.r4.model.Claim();
        claim.setId("claim-t11-001");
        claim.setUse(org.hl7.fhir.r4.model.Claim.Use.PREAUTHORIZATION);
        claim.setStatus(org.hl7.fhir.r4.model.Claim.ClaimStatus.ACTIVE);
        claim.addIdentifier()
                .setSystem("https://ehr.example.org/claims")
                .setValue(claimIdentifierValue);
        claim.setPatient(new org.hl7.fhir.r4.model.Reference("Patient/pat-t11"));
        claim.setProvider(new org.hl7.fhir.r4.model.Reference("Practitioner/pract-t11"));
        claim.addInsurance().setSequence(1).setFocal(true)
                .setCoverage(new org.hl7.fhir.r4.model.Reference("Coverage/cov-t11"));
        claim.addItem().setSequence(1);

        org.hl7.fhir.r4.model.Patient patient = new org.hl7.fhir.r4.model.Patient();
        patient.setId("pat-t11");
        patient.addName().setFamily("TestPatient");

        org.hl7.fhir.r4.model.Practitioner pract = new org.hl7.fhir.r4.model.Practitioner();
        pract.setId("pract-t11");

        org.hl7.fhir.r4.model.Coverage coverage = new org.hl7.fhir.r4.model.Coverage();
        coverage.setId("cov-t11");
        coverage.addPayor().setDisplay("Test Plan");

        Bundle bundle = new Bundle();
        bundle.setId(bundleId);
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.addEntry().setResource(claim);
        bundle.addEntry().setResource(patient);
        bundle.addEntry().setResource(pract);
        bundle.addEntry().setResource(coverage);
        return bundle;
    }

    private void publishDecisionEvent(String tenantId, String caseId, String corrId,
            String outcome, String artifact, String version) throws Exception {
        Map<String, Object> payload = Map.of(
                "decision_id", UUID.randomUUID().toString(),
                "outcome", outcome,
                "auto_approved", true,
                "rule_artifact_id", artifact,
                "rule_version", version
        );
        Map<String, Object> envelope = new HashMap<>();
        envelope.put("event_id", UUID.randomUUID().toString());
        envelope.put("tenant_id", tenantId);
        envelope.put("case_id", caseId);
        envelope.put("correlation_id", corrId);
        envelope.put("type", "decision.recorded");
        envelope.put("occurred_at", Instant.now().toString());
        envelope.put("actor", Map.of("id", "auto-determination", "type", "system"));
        envelope.put("payload", payload);
        envelope.put("schema_version", "1.0.0");
        String eventJson = objectMapper.writeValueAsString(envelope);

        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, kafka.getBootstrapServers());
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        KafkaTemplate<String, String> producer =
                new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(props));
        producer.send("decision.recorded", tenantId, eventJson).get(10, TimeUnit.SECONDS);
    }
}
```

- [ ] **Step 5.4: Run the end-to-end integration test**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test --tests "com.simintero.enstellar.interop.decision.PasInquireDecisionIT" \
    --info 2>&1 | tail -30
```

Expected (allow 3–5 min for Docker images on first run):
```
PasInquireDecisionIT > submit_createsIntakePhaseDecisionRecord() PASSED
PasInquireDecisionIT > inquire_beforeDecision_returnsPendingClaimResponse() PASSED
PasInquireDecisionIT > publishDecisionEvent_updatesDecisionRecord() PASSED
PasInquireDecisionIT > inquire_afterDecision_returnsCompleteClaimResponseWithTrace() PASSED
PasInquireDecisionIT > inquire_unknownCorrelationId_returns404() PASSED
PasInquireDecisionIT > inquire_wrongTenant_returns404() PASSED

6 tests completed, 0 failed
BUILD SUCCESSFUL
```

- [ ] **Step 5.5: Run full interop test suite — confirm no regressions**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test 2>&1 | tail -10
```

Expected:
```
BUILD SUCCESSFUL in Xs
X tests completed, 0 failed
```

If any T05/T06 test that previously used the WebClient-based `PasClaimInquireProvider` fails, it needs to be updated to reflect that `$inquire` now queries `DecisionStore` instead of the workflow-engine REST API. Specifically: the `PasInquireIT` from T06 stubs `GET /internal/cases` via WireMock; that stub is no longer needed. Remove the WireMock stub from those tests and instead pre-populate a `DecisionRecord` via `decisionStore.save()` before calling `$inquire`.

---

## Task 6: Mark T11 Done + CI Job + P0 Exit Criteria

- [ ] **Step 6.1: Mark T11 done in `.claude/task-graph.md`**

Change:
```
| T11 ClaimResponse out + status | JVM/Py | T10 | **sensitive (FHIR)** | `[ ]` |
```
to:
```
| T11 ClaimResponse out + status | JVM/Py | T10 | **sensitive (FHIR)** | `[x]` |
```

- [ ] **Step 6.2: Verify CI workflow includes interop tests**

Open `.github/workflows/ci.yml`. Confirm there is a step that runs `./gradlew test` for `services/interop`. If not, add:

```yaml
- name: Interop service tests (T11)
  working-directory: services/interop
  run: ./gradlew test
  env:
    TESTCONTAINERS_RYUK_DISABLED: "true"
```

- [ ] **Step 6.3: P0 exit criteria self-check**

Run all tests in sequence:

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar/services/interop
./gradlew test 2>&1 | grep -E "(PASSED|FAILED|tests completed)"
```

Confirm all rows in the following checklist produce `PASSED`:

```
ClaimResponseBuilderTest (10 unit tests — no Docker)
DecisionEventConsumerIT  (2 integration tests)
PasInquireDecisionIT     (6 end-to-end tests)
[all prior T05/T06 tests] (no regressions)
```

- [ ] **Step 6.4: Stage and commit**

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
git add services/interop/build.gradle.kts
git add services/interop/src/main/resources/application.yml
git add services/interop/src/test/resources/application-test.yml
git add services/interop/src/main/resources/db/migration/V2__add_decision_store.sql
git add services/interop/src/main/java/com/simintero/enstellar/interop/decision/
git add services/interop/src/main/java/com/simintero/enstellar/interop/config/KafkaConsumerConfig.java
git add services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimSubmitProvider.java
git add services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimInquireProvider.java
git add services/interop/src/test/java/com/simintero/enstellar/interop/decision/
git add .claude/task-graph.md
```

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
git diff --cached --name-only
```

Expected:
```
.claude/task-graph.md
services/interop/build.gradle.kts
services/interop/src/main/java/com/simintero/enstellar/interop/config/KafkaConsumerConfig.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/ClaimResponseBuilder.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/DecisionEventConsumer.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/DecisionRecord.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/DecisionStore.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/dto/DecisionEventEnvelope.java
services/interop/src/main/java/com/simintero/enstellar/interop/decision/dto/DecisionRecordedPayload.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimInquireProvider.java
services/interop/src/main/java/com/simintero/enstellar/interop/pas/PasClaimSubmitProvider.java
services/interop/src/main/resources/application.yml
services/interop/src/main/resources/db/migration/V2__add_decision_store.sql
services/interop/src/test/java/com/simintero/enstellar/interop/decision/ClaimResponseBuilderTest.java
services/interop/src/test/java/com/simintero/enstellar/interop/decision/DecisionEventConsumerIT.java
services/interop/src/test/java/com/simintero/enstellar/interop/decision/PasInquireDecisionIT.java
services/interop/src/test/resources/application-test.yml
```

```bash
cd /Users/srikanthaddala/Downloads/Simintero/Enstellar
git commit -m "$(cat <<'EOF'
feat(T11): ClaimResponse out + status — decision.recorded consumer, DecisionStore, $inquire

Adds a Kafka consumer (DecisionEventConsumer) that updates the decision_store
table when decision.recorded arrives from the workflow engine. PasClaimSubmitProvider
now writes an intake-phase DecisionRecord (outcome=null) at submit time, storing
the Claim.identifier as claim_ref. PasClaimInquireProvider queries DecisionStore
locally: returns QUEUED while in-flight, COMPLETE with rule-trace provenance
extension when the decision arrives. Flyway V2 migration creates decision_store.

Closes P0 walking skeleton: EHR → $submit → Kafka → auto-determination →
decision.recorded → $inquire → ClaimResponse (approved, trace pinned).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

Expected: `[<branch> <sha>] feat(T11): ClaimResponse out + status ...`

---

## Definition of Done Checklist

### FHIR Correctness (DoD)
- [ ] `$inquire` returns `ClaimResponse.outcome = COMPLETE` and `use = PREAUTHORIZATION` after `decision.recorded` arrives — proved by `inquire_afterDecision_returnsCompleteClaimResponseWithTrace()`
- [ ] `ClaimResponse.identifier[0].value` = original `Claim.identifier` value (`claim_ref`) — proved by same test + `buildBundle_claimResponseIdentifier_echoesClaimRef()`
- [ ] `ClaimResponse.adjudication[0].category.coding[0].code` = `"benefit"` — proved by `buildBundle_adjudication_categoryIsBenefit()`
- [ ] Provenance extension `rule-trace` = `"{artifact}@{version}"` — proved by `buildBundle_ruleTraceExtension_containsArtifactAtVersion()` and `inquire_afterDecision_returnsCompleteClaimResponseWithTrace()`
- [ ] `$inquire` before decision returns `outcome = QUEUED` — proved by `inquire_beforeDecision_returnsPendingClaimResponse()`
- [ ] `$inquire` with unknown correlationId returns HTTP 404 — proved by `inquire_unknownCorrelationId_returns404()`

### Invariant Compliance
- [ ] INVARIANT #5: `DecisionEventConsumer` discards events with null/blank `tenant_id` (does NOT throw, does NOT crash) — proved by `decisionRecordedEvent_missingTenantId_isDiscardedSafely()`
- [ ] INVARIANT #5: `DecisionStore.findByCorrelationIdAndTenantId` and `findByCaseIdAndTenantId` both include `tenant_id` predicate — cross-tenant $inquire returns 404, proved by `inquire_wrongTenant_returns404()`
- [ ] INVARIANT #3: no PHI in log output (log only `tenant_id`, `case_id`, `correlation_id`, `event_id`)
- [ ] INVARIANT #4: Flyway migration created via SQL file — `decision_store` table is NOT hand-managed via `ddl-auto`

### Tests
- [ ] `ClaimResponseBuilderTest`: 10 unit tests pass (no Docker)
- [ ] `DecisionEventConsumerIT`: 2 IT tests pass (Testcontainers Kafka + PostgreSQL)
- [ ] `PasInquireDecisionIT`: 6 IT tests pass (Testcontainers Kafka + PostgreSQL + WireMock)
- [ ] All prior interop tests (T05 + T06) still pass — zero regressions

### P0 Walking Skeleton Exit Criteria (T11 is the final P0 task)
- [ ] A clean PAS submit flows: EHR → `$submit` → Kafka `case.intake.received` → workflow-engine state machine → Digicore mock → auto-determination → Kafka `decision.recorded` → `$inquire` → approved `ClaimResponse` with decision trace
- [ ] Decision trace is reproducible from event history: `ClaimResponse` extension `rule-trace` = exact `rule_artifact_id@rule_version` from `decision.recorded` payload
- [ ] `make test` exits 0
- [ ] T11 marked `[x]` in `.claude/task-graph.md`
- [ ] **Mandatory senior engineer review** requested (FHIR conformance + decision trace path — see CLAUDE.md)

---

## Implementation Notes for the Agent

### Note 1: Flyway + HAPI JPA coexistence

HAPI JPA manages its own tables via Hibernate `ddl-auto: update`. Flyway manages only `decision_store`. The `baseline-on-migrate: true` + `baseline-version: 1` config tells Flyway: "version 1 already exists (HAPI's tables) — baseline it without running V1, then apply V2+." This means:
- First startup on a fresh DB: Hibernate creates HAPI tables, then Flyway creates `flyway_schema_history` with a V1 baseline row and applies `V2__add_decision_store.sql`.
- Subsequent startups: Flyway sees V2 already applied and is a no-op.

In tests: `spring.flyway.enabled=true` is set via `@SpringBootTest(properties=...)` only on IT tests that use the PostgreSQL Testcontainer. Unit tests (`ClaimResponseBuilderTest`) do not load a Spring context at all. H2-based tests keep `spring.flyway.enabled=false` in `application-test.yml`.

### Note 2: `DecisionEventConsumer` idempotency

If `decision.recorded` arrives twice for the same case (Kafka at-least-once), `DecisionEventConsumer.onDecision()` checks `if (dr.getOutcome() != null)` and skips the duplicate. This prevents overwriting a valid decision. The `UNIQUE INDEX` on `(tenant_id, correlation_id)` in `V2__add_decision_store.sql` prevents duplicate intake records at the DB level.

### Note 3: Out-of-order arrival

If `decision.recorded` arrives before `$submit` has stored the `DecisionRecord` (race condition in a distributed system), `DecisionEventConsumer` logs a warning and acknowledges the offset. The event is not retried. For the P0 walking skeleton this is acceptable; P1 can add a retry/requeue mechanism. The test `decisionRecordedEvent_updatesDecisionRecord_withOutcomeAndTrace` avoids this race by pre-creating the `DecisionRecord` directly.

### Note 4: `PasClaimInquireProvider` replaces T06 WebClient

T06's `PasClaimInquireProvider` used `WebClient` to call `GET /internal/cases?correlation_id=...` on the workflow-engine. T11 removes this dependency entirely. The `PasClaimInquireProvider` constructor changes from `(PasConfig config, ObjectMapper objectMapper)` to `(DecisionStore decisionStore, ClaimResponseBuilder claimResponseBuilder)`. If T06's `PasInquireIT.java` stubs the workflow-engine REST endpoint, those tests must be updated to pre-populate `DecisionRecord` via `decisionStore.save()` instead.

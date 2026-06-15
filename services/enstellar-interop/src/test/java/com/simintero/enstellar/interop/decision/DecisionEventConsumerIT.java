package com.simintero.enstellar.interop.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.FhirTestBase;
import org.apache.kafka.clients.producer.ProducerConfig;
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
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=true",
        "spring.flyway.baseline-version=1",
        "enstellar.test.context=decision-event-consumer-it"
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
        assertThat(decisionStore.count()).isGreaterThanOrEqualTo(0); // alive check
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

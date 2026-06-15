package com.simintero.enstellar.interop.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringSerializer;
import org.hl7.fhir.r4.model.Bundle;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.*;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.containers.MinIOContainer;
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
 * The unique "enstellar.test.context" property ensures this class gets its own
 * Spring ApplicationContext (not shared with DecisionEventConsumerIT, which also
 * uses flyway-enabled + Kafka but with a different container instance).
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {
        "spring.flyway.enabled=true",
        "spring.flyway.baseline-on-migrate=true",
        "spring.flyway.baseline-version=1",
        "enstellar.test.context=pas-inquire-decision-it"
    }
)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PasInquireDecisionIT extends FhirTestBase {

    @Container
    static KafkaContainer kafka = new KafkaContainer(
            DockerImageName.parse("confluentinc/cp-kafka:7.6.1"));

    @Container
    static MinIOContainer minio = new MinIOContainer(
            DockerImageName.parse("minio/minio:RELEASE.2024-06-04T19-20-08Z"));

    static WireMockServer wireMock;

    @Autowired
    ObjectMapper objectMapper;

    @Autowired
    DecisionStore decisionStore;

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
        registry.add("MINIO_ENDPOINT", () -> minio.getS3URL().replace("http://", ""));
        registry.add("MINIO_ACCESS_KEY", minio::getUserName);
        registry.add("MINIO_SECRET_KEY", minio::getPassword);
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.baseline-on-migrate", () -> "true");
    }

    // -----------------------------------------------------------------------
    // Test 1: $submit creates intake-phase DecisionRecord
    // -----------------------------------------------------------------------

    @Test
    @Order(1)
    void submit_createsIntakePhaseDecisionRecord() throws Exception {
        stubNormalize(TENANT_ID, correlationId);

        Bundle requestBundle = buildPasBundle(correlationId, CLAIM_REF);
        String bundleJson = ca.uhn.fhir.context.FhirContext.forR4()
                .newJsonParser().encodeResourceToString(requestBundle);

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(mintJwt(TENANT_ID, "system/*.write"));
        headers.setContentType(MediaType.valueOf("application/fhir+json"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> resp = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );
        assertThat(resp.getStatusCode().is2xxSuccessful())
                .as("$submit response: %s", resp.getBody()).isTrue();

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
    void inquire_beforeDecision_returnsPendingClaimResponse() throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(mintJwt(TENANT_ID, "system/*.read"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> resp = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/" + correlationId + "/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class
        );

        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();
        com.fasterxml.jackson.databind.JsonNode body = objectMapper.readTree(resp.getBody());
        com.fasterxml.jackson.databind.JsonNode cr = body.path("entry").path(0).path("resource");
        assertThat(cr.path("outcome").asText()).isEqualTo("queued");
        assertThat(cr.path("use").asText()).isEqualTo("preauthorization");
        assertThat(cr.path("identifier").path(0).path("value").asText()).isEqualTo(CLAIM_REF);
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
    void inquire_afterDecision_returnsCompleteClaimResponseWithTrace() throws Exception {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(mintJwt(TENANT_ID, "system/*.read"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> resp = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/" + correlationId + "/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class
        );

        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();
        com.fasterxml.jackson.databind.JsonNode body = objectMapper.readTree(resp.getBody());
        com.fasterxml.jackson.databind.JsonNode cr = body.path("entry").path(0).path("resource");

        // DoD: outcome = COMPLETE
        assertThat(cr.path("outcome").asText()).isEqualTo("complete");
        assertThat(cr.path("use").asText()).isEqualTo("preauthorization");

        // DoD: ClaimResponse.identifier echoes Claim.identifier
        assertThat(cr.path("identifier").path(0).path("value").asText()).isEqualTo(CLAIM_REF);
        assertThat(cr.path("identifier").path(0).path("system").asText())
                .isEqualTo("https://enstellar.simintero.com/auth-tracking");

        // DoD: adjudication with category=benefit
        assertThat(cr.path("item").path(0).path("adjudication").path(0)
                .path("category").path("coding").path(0).path("code").asText())
                .isEqualTo("benefit");

        // DoD: decision trace reproducible from event history
        boolean hasRuleTrace = false;
        for (com.fasterxml.jackson.databind.JsonNode ext : cr.path("extension")) {
            if (ext.path("url").asText()
                    .equals("https://enstellar.simintero.com/fhir/StructureDefinition/rule-trace")) {
                assertThat(ext.path("valueString").asText()).isEqualTo("policy-v2-2026-q2@2.1.0");
                hasRuleTrace = true;
            }
        }
        assertThat(hasRuleTrace).isTrue();
    }

    // -----------------------------------------------------------------------
    // Test 5: $inquire unknown correlationId → 404
    // -----------------------------------------------------------------------

    @Test
    @Order(5)
    void inquire_unknownCorrelationId_returns404() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(mintJwt(TENANT_ID, "system/*.read"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> resp = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/corr-never-submitted/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class
        );

        assertThat(resp.getStatusCode().value()).isEqualTo(404);
    }

    // -----------------------------------------------------------------------
    // Test 6: cross-tenant $inquire → 404 (tenant isolation)
    // -----------------------------------------------------------------------

    @Test
    @Order(6)
    void inquire_wrongTenant_returns404() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(mintJwt("tenant-wrong", "system/*.read"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> resp = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/" + correlationId + "/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class
        );

        assertThat(resp.getStatusCode().value()).isEqualTo(404);
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
        claim.setInsurer(new org.hl7.fhir.r4.model.Reference("Organization/payer-t11"));
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

package com.simintero.enstellar.interop.pas;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import io.minio.ListObjectsArgs;
import io.minio.MinioClient;
import io.minio.Result;
import io.minio.messages.Item;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

class PasSubmitIT extends FhirTestBase {

    static final WireMockServer WIRE_MOCK;
    static final KafkaContainer KAFKA;
    static final MinIOContainer MINIO;

    static {
        WIRE_MOCK = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        WIRE_MOCK.start();
        WireMock.configureFor("localhost", WIRE_MOCK.port());

        KAFKA = new KafkaContainer(DockerImageName.parse("confluentinc/cp-kafka:7.6.1"));
        KAFKA.start();

        MINIO = new MinIOContainer(DockerImageName.parse("minio/minio:RELEASE.2024-06-04T19-20-08Z"));
        MINIO.start();
    }

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("NORMALIZATION_URL", () -> "http://localhost:" + WIRE_MOCK.port());
        registry.add("spring.kafka.bootstrap-servers", KAFKA::getBootstrapServers);
        registry.add("MINIO_ENDPOINT", () -> MINIO.getS3URL().replace("http://", ""));
        registry.add("MINIO_ACCESS_KEY", MINIO::getUserName);
        registry.add("MINIO_SECRET_KEY", MINIO::getPassword);
    }

    @BeforeEach
    void resetWireMock() {
        WIRE_MOCK.resetAll();
    }

    private void stubNormalize(String tenantId, String correlationId) {
        WIRE_MOCK.stubFor(
            post(urlEqualTo("/internal/normalize"))
                .willReturn(okJson("""
                    {
                      "case_id": "550e8400-e29b-41d4-a716-446655440000",
                      "tenant_id": "%s",
                      "correlation_id": "%s",
                      "status": "intake",
                      "lob": "commercial",
                      "_raw_bundle_key": "enstellar-raw-bundles/%s/raw-bundles/2026-06-06/%s.json"
                    }
                    """.formatted(tenantId, correlationId, tenantId, correlationId))
                )
        );
    }

    private HttpHeaders pasFhirHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setContentType(MediaType.valueOf("application/fhir+json"));
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return headers;
    }

    @Test
    void submit_validBundle_returns200WithApprovedClaimResponse() throws Exception {
        // The PAS decision is ASYNC: $submit durably records the case and returns a
        // QUEUED ClaimResponse immediately; the final `complete` outcome only appears
        // after the DecisionEventConsumer processes a `decision.recorded` Kafka event,
        // observed by re-$inquire-ing GET /fhir/Claim/{correlationId}/$inquire.
        // Asserting `complete` on the $submit response directly is a race (was the source
        // of the prior flakiness). We award determinism by awaiting the $inquire outcome.
        String tenantId = "tenant-submit-200";
        String correlationId = "pas-test-bundle-001";
        // The stub returns this fixed case_id; the consumer matches on case_id + tenant_id.
        String caseId = "550e8400-e29b-41d4-a716-446655440000";
        stubNormalize(tenantId, correlationId);

        String bundleJson = PasTestBundles.validPasBundleJson();
        String submitToken = mintJwt(tenantId, "patient/*.read patient/*.write");
        HttpHeaders headers = pasFhirHeaders(submitToken);

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();

        ObjectMapper json = new ObjectMapper();
        JsonNode body = json.readTree(response.getBody());
        assertThat(body.path("resourceType").asText()).isEqualTo("Bundle");
        JsonNode claimResponse = body.path("entry").path(0).path("resource");
        assertThat(claimResponse.path("resourceType").asText()).isEqualTo("ClaimResponse");
        assertThat(claimResponse.path("use").asText()).isEqualTo("preauthorization");
        // $submit is async — the immediate outcome is QUEUED, not COMPLETE.
        assertThat(claimResponse.path("outcome").asText()).isEqualTo("queued");

        // Drive the async decision: publish a decision.recorded event (outcome=approved).
        // The DecisionEventConsumer consumes it and flips the DecisionRecord to decided.
        publishDecisionEvent(tenantId, caseId, correlationId,
                "approved", "policy-v2-2026-q2", "2.1.0");

        // AWAIT the deterministic final condition: re-$inquire until outcome flips to
        // `complete` (mapped from "approved"). Re-fetch the resource inside the poll —
        // never assert the async outcome instantly.
        HttpHeaders inquireHeaders = new HttpHeaders();
        inquireHeaders.setBearerAuth(submitToken);
        inquireHeaders.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        org.awaitility.Awaitility.await()
                .atMost(java.time.Duration.ofSeconds(20))
                .pollInterval(java.time.Duration.ofMillis(250))
                .untilAsserted(() -> {
                    ResponseEntity<String> inquireResp = restTemplate.exchange(
                        "http://localhost:" + port + "/fhir/Claim/" + correlationId + "/$inquire",
                        HttpMethod.GET,
                        new HttpEntity<>(inquireHeaders),
                        String.class
                    );
                    assertThat(inquireResp.getStatusCode().is2xxSuccessful()).isTrue();
                    JsonNode inquireBody = new ObjectMapper().readTree(inquireResp.getBody());
                    JsonNode cr = inquireBody.path("entry").path(0).path("resource");
                    assertThat(cr.path("resourceType").asText()).isEqualTo("ClaimResponse");
                    assertThat(cr.path("use").asText()).isEqualTo("preauthorization");
                    // The SAME final condition the original test asserted — now awaited.
                    assertThat(cr.path("outcome").asText()).isEqualTo("complete");
                });
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
        String eventJson = new ObjectMapper().writeValueAsString(envelope);

        Map<String, Object> props = new HashMap<>();
        props.put(org.apache.kafka.clients.producer.ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
                KAFKA.getBootstrapServers());
        props.put(org.apache.kafka.clients.producer.ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
                org.apache.kafka.common.serialization.StringSerializer.class);
        props.put(org.apache.kafka.clients.producer.ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
                org.apache.kafka.common.serialization.StringSerializer.class);
        org.springframework.kafka.core.KafkaTemplate<String, String> producer =
                new org.springframework.kafka.core.KafkaTemplate<>(
                        new org.springframework.kafka.core.DefaultKafkaProducerFactory<>(props));
        producer.send("decision.recorded", tenantId, eventJson)
                .get(10, java.util.concurrent.TimeUnit.SECONDS);
    }

    @Test
    void submit_rawBundleStoredInMinio() throws Exception {
        String tenantId = "tenant-submit-minio";
        stubNormalize(tenantId, "pas-test-bundle-001");

        String bundleJson = PasTestBundles.validPasBundleJson();
        HttpHeaders headers = pasFhirHeaders(mintJwt(tenantId, "patient/*.read patient/*.write"));

        restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );

        MinioClient minioClient = MinioClient.builder()
            .endpoint(MINIO.getS3URL())
            .credentials(MINIO.getUserName(), MINIO.getPassword())
            .build();

        Iterable<Result<Item>> objects = minioClient.listObjects(
            ListObjectsArgs.builder()
                .bucket("enstellar-raw-bundles")
                .prefix(tenantId + "/raw-bundles/")
                .build()
        );
        assertThat(objects.iterator().hasNext()).isTrue();
    }

    @Test
    void submit_publishesCaseIntakeEventToKafka() throws Exception {
        String tenantId = "tenant-submit-kafka";
        stubNormalize(tenantId, "pas-test-bundle-001");

        String bundleJson = PasTestBundles.validPasBundleJson();
        HttpHeaders headers = pasFhirHeaders(mintJwt(tenantId, "patient/*.read patient/*.write"));

        restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );

        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "test-consumer-" + UUID.randomUUID());
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        ConsumerRecord<String, String> record = null;
        try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props)) {
            consumer.subscribe(List.of("case.intake.received"));
            long deadline = System.currentTimeMillis() + 15_000;
            while (record == null && System.currentTimeMillis() < deadline) {
                var records = consumer.poll(Duration.ofMillis(500));
                if (!records.isEmpty()) {
                    record = records.iterator().next();
                }
            }
        }
        assertThat(record).isNotNull();
        assertThat(record.key()).isEqualTo(tenantId);
        assertThat(record.value()).contains("case.intake.received");
    }

    @Test
    void submit_invalidBundle_returns422() {
        String tenantId = "tenant-submit-422";
        String badBundleJson = """
            {"resourceType":"Bundle","id":"bad-bundle-001","type":"transaction","entry":[]}
            """;
        HttpHeaders headers = pasFhirHeaders(mintJwt(tenantId, "patient/*.read patient/*.write"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(badBundleJson, headers),
            String.class
        );

        assertThat(response.getStatusCode().value()).isEqualTo(422);
    }

    @Test
    void submit_withoutToken_returns401() {
        String bundleJson = PasTestBundles.validPasBundleJson();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.valueOf("application/fhir+json"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );

        assertThat(response.getStatusCode().value()).isEqualTo(401);
    }
}

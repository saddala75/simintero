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
    void submit_validBundle_returns200WithApprovedClaimResponse() {
        String tenantId = "tenant-submit-200";
        stubNormalize(tenantId, "pas-test-bundle-001");

        String bundleJson = PasTestBundles.validPasBundleJson();
        HttpHeaders headers = pasFhirHeaders(mintJwt(tenantId, "patient/*.read patient/*.write"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST,
            new HttpEntity<>(bundleJson, headers),
            String.class
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();

        ObjectMapper json = new ObjectMapper();
        JsonNode body;
        try {
            body = json.readTree(response.getBody());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        assertThat(body.path("resourceType").asText()).isEqualTo("Bundle");
        JsonNode claimResponse = body.path("entry").path(0).path("resource");
        assertThat(claimResponse.path("resourceType").asText()).isEqualTo("ClaimResponse");
        assertThat(claimResponse.path("outcome").asText()).isEqualTo("complete");
        assertThat(claimResponse.path("use").asText()).isEqualTo("preauthorization");
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

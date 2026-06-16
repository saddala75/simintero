package com.simintero.enstellar.interop.dtr;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

/** DTR Questionnaire (GET, from Digicore) + QuestionnaireResponse (POST -> PAS pipeline). */
@Tag("integration")
class DtrProvidersIT extends FhirTestBase {

    static final WireMockServer WIRE_MOCK; // serves digicore-runtime C-1 (/v1/runtime/*) and normalization (/internal/normalize)
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
    static void props(DynamicPropertyRegistry registry) {
        registry.add("enstellar.digicore.base-url", () -> "http://localhost:" + WIRE_MOCK.port());
        registry.add("NORMALIZATION_URL", () -> "http://localhost:" + WIRE_MOCK.port());
        registry.add("spring.kafka.bootstrap-servers", KAFKA::getBootstrapServers);
        registry.add("MINIO_ENDPOINT", () -> MINIO.getS3URL().replace("http://", ""));
        registry.add("MINIO_ACCESS_KEY", MINIO::getUserName);
        registry.add("MINIO_SECRET_KEY", MINIO::getPassword);
    }

    @BeforeEach
    void reset() {
        WIRE_MOCK.resetAll();
    }

    private HttpHeaders fhirHeaders() {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(mintJwt("dtr-tenant", "patient/*.write"));
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }

    @Test
    void get_questionnaire_returns_digicore_artifact_without_proxying() {
        String encodedRef = "urn%3Asim%3Adtr%3Aknee-arthroscopy%3A1.0.0";
        WIRE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/coverage-discovery")).willReturn(okJson("""
                {"pa_required": true,
                 "governing_rules": [{"rule_id": "rule-1", "version": "1.0.0"}],
                 "pins": [],
                 "dtr_package_ref": "urn:sim:dtr:knee-arthroscopy:1.0.0"}
                """)));
        WIRE_MOCK.stubFor(get(urlPathEqualTo("/v1/runtime/dtr-packages/" + encodedRef)).willReturn(okJson("""
                {"resourceType":"Questionnaire","id":"dtr-svc-1","status":"active",
                 "item":[{"linkId":"indication","text":"Clinical indication","type":"string"}]}
                """)));

        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Questionnaire?context=svc-1&plan=plan-1",
                HttpMethod.GET, new HttpEntity<>(fhirHeaders()), String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resp.getBody()).contains("Questionnaire").contains("indication");
        // proxy bypass: the external HAPI mock must not have been called
        HAPI_MOCK.verify(0, anyRequestedFor(anyUrl()));
        WIRE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/coverage-discovery")));
        WIRE_MOCK.verify(getRequestedFor(urlPathEqualTo("/v1/runtime/dtr-packages/" + encodedRef)));
    }

    @Test
    void get_questionnaire_for_service_without_dtr_package_returns_clean_404() {
        // Non-knee / no-DTR-package service: coverage-discovery yields a null dtr_package_ref.
        WIRE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/coverage-discovery")).willReturn(okJson("""
                {"pa_required": false,
                 "governing_rules": [],
                 "pins": [],
                 "dtr_package_ref": null}
                """)));

        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Questionnaire?context=office-visit&plan=plan-1",
                HttpMethod.GET, new HttpEntity<>(fhirHeaders()), String.class);

        // Clean FHIR 404 OperationOutcome, not a 500/NPE.
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(resp.getBody()).contains("OperationOutcome").contains("No DTR package");
        // No dtr-package fetch should be attempted when the ref is null.
        WIRE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/coverage-discovery")));
        WIRE_MOCK.verify(0, getRequestedFor(urlPathMatching("/v1/runtime/dtr-packages/.*")));
    }

    @Test
    void post_questionnaire_response_feeds_pas_pipeline() {
        WIRE_MOCK.stubFor(post(urlEqualTo("/internal/normalize")).willReturn(okJson("""
                {"case_id":"550e8400-e29b-41d4-a716-446655440000","tenant_id":"dtr-tenant",
                 "correlation_id":"dtr-corr-1","status":"intake","lob":"commercial",
                 "_raw_bundle_key":"enstellar-raw-bundles/dtr-tenant/raw-bundles/2026-06-08/x.json"}
                """)));

        String qr = """
                {"resourceType":"QuestionnaireResponse","status":"completed",
                 "questionnaire":"https://enstellar.simintero.com/Questionnaire/dtr-svc-1",
                 "subject":{"reference":"Patient/p1"}}""";

        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/QuestionnaireResponse",
                HttpMethod.POST, new HttpEntity<>(qr, fhirHeaders()), String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        // the PAS pipeline ran through normalization
        WIRE_MOCK.verify(postRequestedFor(urlEqualTo("/internal/normalize")));
    }

    @Test
    void invalid_questionnaire_response_returns_422() {
        String qr = """
                {"resourceType":"QuestionnaireResponse"}"""; // no status, no questionnaire

        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/QuestionnaireResponse",
                HttpMethod.POST, new HttpEntity<>(qr, fhirHeaders()), String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
    }
}

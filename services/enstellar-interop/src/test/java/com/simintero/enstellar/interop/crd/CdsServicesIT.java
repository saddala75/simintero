package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
class CdsServicesIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();
    static final WireMockServer DIGICORE_MOCK;

    static {
        DIGICORE_MOCK = new WireMockServer(WireMockConfiguration.options().dynamicPort());
        DIGICORE_MOCK.start();
    }

    @AfterAll
    static void stop() {
        DIGICORE_MOCK.stop();
    }

    @DynamicPropertySource
    static void digicoreUrl(DynamicPropertyRegistry registry) {
        registry.add("enstellar.digicore.base-url", () -> "http://localhost:" + DIGICORE_MOCK.port());
    }

    @BeforeEach
    void reset() {
        DIGICORE_MOCK.resetAll();
    }

    @Test
    void discovery_lists_three_hooks() throws Exception {
        ResponseEntity<String> resp = restTemplate.getForEntity(
                "http://localhost:" + port + "/cds-services", String.class);
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode services = JSON.readTree(resp.getBody()).path("services");
        assertThat(services).hasSize(3);
        assertThat(services).extracting(s -> s.path("hook").asText())
                .containsExactlyInAnyOrder("order-select", "order-sign", "appointment-book");
    }

    @Test
    void order_sign_pa_required_returns_dtr_launch_card() throws Exception {
        DIGICORE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/coverage-discovery")).willReturn(okJson("""
                {"pa_required": true,
                 "governing_rules": [{"rule_id": "rule-1", "version": "1.0.0"}],
                 "pins": [],
                 "dtr_package_ref": "urn:sim:dtr:knee-arthroscopy:1.0.0"}
                """)));
        DIGICORE_MOCK.stubFor(post(urlPathEqualTo("/v1/runtime/evidence-requirements:resolve")).willReturn(okJson("""
                {"service_code": "svc-1",
                 "requirements": [{"requirement_id": "r1", "display": "clinical-notes", "required": true}]}
                """)));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Tenant-Id", "t1");
        String body = """
                {"hook":"order-sign","hookInstance":"x",
                 "context":{"serviceCode":"svc-1","patientId":"p1","planId":"plan-1"}}""";

        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/cds-services/order-sign",
                HttpMethod.POST, new HttpEntity<>(body, headers), String.class);

        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode cards = JSON.readTree(resp.getBody()).path("cards");
        boolean hasSmartLink = false;
        for (JsonNode c : cards) {
            for (JsonNode l : c.path("links")) {
                if ("smart".equals(l.path("type").asText())) hasSmartLink = true;
            }
        }
        assertThat(hasSmartLink).as("a DTR smart launch link is present").isTrue();
        // the CRD invoke fans out to the C-1 coverage-discovery + evidence-requirements endpoints
        DIGICORE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/coverage-discovery"))
                .withRequestBody(matchingJsonPath("$.service_code", equalTo("svc-1"))));
        DIGICORE_MOCK.verify(postRequestedFor(urlPathEqualTo("/v1/runtime/evidence-requirements:resolve"))
                .withRequestBody(matchingJsonPath("$.service_code", equalTo("svc-1"))));
        // /cds-services is NOT a FHIR path — the proxy must never intercept it (regression guard).
        HAPI_MOCK.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void missing_tenant_returns_401() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String body = """
                {"hook":"order-sign","hookInstance":"x","context":{"serviceCode":"svc-1"}}""";
        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/cds-services/order-sign",
                HttpMethod.POST, new HttpEntity<>(body, headers), String.class);
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void unknown_hook_returns_404() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("X-Tenant-Id", "t1");
        ResponseEntity<String> resp = restTemplate.exchange(
                "http://localhost:" + port + "/cds-services/nope",
                HttpMethod.POST, new HttpEntity<>("{\"hook\":\"x\"}", headers), String.class);
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }
}

package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.proxy.TenantTagUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

class TenantIsolationIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void stubHapi() {
        HAPI_MOCK.stubFor(post(urlEqualTo("/fhir/Patient"))
            .willReturn(aResponse().withStatus(201)
                .withHeader("Content-Type", "application/fhir+json")
                .withHeader("Location", "http://localhost/fhir/Patient/test-p1")
                .withBody("{\"resourceType\":\"Patient\",\"id\":\"test-p1\"}")));

        // Searches scoped to the "other" tenant return empty bundles (proxy injects _security).
        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient.*"))
            .willReturn(okJson("{\"resourceType\":\"Bundle\",\"entry\":[]}")));
    }

    @Test
    void jwt_without_tenant_id_claim_returns_401() {
        String tokenWithoutTenant = mintJwt(null, "patient/*.read");
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(tokenWithoutTenant);
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> response = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void unauthenticated_request_after_authenticated_returns_401() {
        // Make an authenticated request, then a request without any token.
        // If ThreadLocal leaked, the second request would carry tenant context from the first —
        // but Spring Security rejects unauthenticated requests at 401 before HAPI is reached,
        // proving the ThreadLocal cannot be weaponised to bypass authentication.
        String token = mintJwt("tenant-test", "patient/*.read");
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        // First request — authenticated, should succeed (empty bundle is fine)
        ResponseEntity<String> first = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);

        // Second request — no token, must be rejected at 401 regardless of ThreadLocal state
        ResponseEntity<String> second = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/Patient", String.class);
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void tenant_context_does_not_leak_between_sequential_requests() throws Exception {
        // Patient created under tenant-alpha must not appear in a subsequent tenant-beta search
        // on the same HTTP client (same underlying connection pool thread).
        String tokenAlpha = mintJwt("tenant-leak-alpha", "patient/*.read patient/*.write");
        String tokenBeta = mintJwt("tenant-leak-beta", "patient/*.read");
        HttpHeaders headersAlpha = fhirHeaders(tokenAlpha);

        // Create a patient under tenant-alpha
        String mrn = "LEAK-TEST-" + System.currentTimeMillis();
        String patientJson = """
                {
                  "resourceType": "Patient",
                  "identifier": [{"system": "http://example.org/mrn", "value": "%s"}],
                  "name": [{"family": "LeakTest", "given": ["Alpha"]}],
                  "gender": "unknown",
                  "birthDate": "1990-01-01"
                }
                """.formatted(mrn);

        ResponseEntity<String> create = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(patientJson, headersAlpha),
                String.class);
        assertThat(create.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        // Immediately search under tenant-beta (same client, same thread pool) — must see 0 results
        HttpHeaders headersBeta = new HttpHeaders();
        headersBeta.setBearerAuth(tokenBeta);
        headersBeta.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        ResponseEntity<String> search = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?identifier=http://example.org/mrn|" + mrn,
                HttpMethod.GET,
                new HttpEntity<>(headersBeta),
                String.class);
        assertThat(search.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode bundle = JSON.readTree(search.getBody());
        assertThat(bundle.path("entry").size())
                .as("tenant-leak-beta must not see tenant-leak-alpha's patient — ThreadLocal must be cleared between requests")
                .isEqualTo(0);

        // The beta search must carry beta's tenant tag and NOT alpha's — proves the
        // ThreadLocal tenant context did not leak from the preceding alpha request.
        HAPI_MOCK.verify(getRequestedFor(urlPathEqualTo("/fhir/Patient"))
            .withQueryParam("_security", containing(TenantTagUtil.TENANT_SYSTEM + "|tenant-leak-beta")));
        HAPI_MOCK.verify(0, getRequestedFor(urlPathEqualTo("/fhir/Patient"))
            .withQueryParam("_security", containing(TenantTagUtil.TENANT_SYSTEM + "|tenant-leak-alpha")));
    }

    @Test
    void patient_created_in_tenant_A_is_invisible_to_tenant_B() throws Exception {
        String tokenA = mintJwt("tenant-alpha", "patient/*.read patient/*.write");
        String tokenB = mintJwt("tenant-beta", "patient/*.read");

        HttpHeaders headersA = fhirHeaders(tokenA);
        HttpHeaders headersB = new HttpHeaders();
        headersB.setBearerAuth(tokenB);
        headersB.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        String patientJson = """
                {
                  "resourceType": "Patient",
                  "identifier": [{"system": "http://example.org/mrn", "value": "ALPHA-ONLY-999"}],
                  "name": [{"family": "AlphaOnly", "given": ["Test"]}],
                  "gender": "unknown",
                  "birthDate": "1990-01-01"
                }
                """;

        ResponseEntity<String> create = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.POST,
                new HttpEntity<>(patientJson, headersA),
                String.class);
        assertThat(create.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> search = restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient?identifier=http://example.org/mrn|ALPHA-ONLY-999",
                HttpMethod.GET,
                new HttpEntity<>(headersB),
                String.class);
        assertThat(search.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode bundle = JSON.readTree(search.getBody());
        int entryCount = bundle.path("entry").size();
        assertThat(entryCount)
                .as("tenant-beta must not see tenant-alpha's patient").isEqualTo(0);

        // The proxy must scope the search to the caller's tenant (tenant-beta) and never
        // carry tenant-alpha's tag — this is what actually enforces isolation.
        HAPI_MOCK.verify(getRequestedFor(urlPathEqualTo("/fhir/Patient"))
            .withQueryParam("_security", containing(TenantTagUtil.TENANT_SYSTEM + "|tenant-beta")));
        HAPI_MOCK.verify(0, getRequestedFor(urlPathEqualTo("/fhir/Patient"))
            .withQueryParam("_security", containing(TenantTagUtil.TENANT_SYSTEM + "|tenant-alpha")));
    }

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }
}

package com.simintero.enstellar.interop;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

class SmartAuthIT extends FhirTestBase {

    @BeforeEach
    void stubPatientSearch() {
        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient.*"))
            .willReturn(okJson("{\"resourceType\":\"Bundle\",\"entry\":[]}")));
    }

    @Test
    void unauthenticated_GET_Patient_returns_401() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/Patient", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void unauthenticated_GET_metadata_returns_200() {
        ResponseEntity<String> response = restTemplate.getForEntity(
                "http://localhost:" + port + "/fhir/metadata", String.class);
        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
    }

    @Test
    void authenticated_GET_Patient_with_valid_token_returns_200() {
        String token = mintJwt("test-tenant", "patient/*.read");
        ResponseEntity<String> response = callPatientWithToken(token);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void token_missing_aud_claim_is_rejected_401() {
        // Audit requirement: a token with NO `aud` claim must be rejected by the
        // audience validator (realm simintero), not silently accepted.
        String token = mintJwt("test-tenant", "patient/*.read", null);
        ResponseEntity<String> response = callPatientWithToken(token);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void token_with_wrong_aud_is_rejected_401() {
        String token = mintJwt("test-tenant", "patient/*.read", List.of("some-other-api"));
        ResponseEntity<String> response = callPatientWithToken(token);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    private ResponseEntity<String> callPatientWithToken(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return restTemplate.exchange(
                "http://localhost:" + port + "/fhir/Patient",
                HttpMethod.GET,
                new HttpEntity<>(headers),
                String.class);
    }
}

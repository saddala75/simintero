package com.simintero.enstellar.interop.auth;

import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;
import org.springframework.test.context.TestPropertySource;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

@TestPropertySource(properties = {
    "interop.conformance-test-mode=true",
    "interop.conformance-test-token=ci-test-token-abc123"
})
class ConformanceTestAuthFilterIT extends FhirTestBase {

    @BeforeEach
    void stubPatientSearch() {
        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient.*"))
            .willReturn(okJson("{\"resourceType\":\"Bundle\",\"entry\":[]}")));
    }

    @Test
    void valid_static_token_returns_200_for_metadata() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("ci-test-token-abc123");
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        // /fhir/metadata is a safe read-only probe — served by the embedded HAPI servlet.
        // Without the filter, Spring Security's BearerTokenAuthenticationFilter would reject
        // "ci-test-token-abc123" as an invalid JWT (401) even though the path is permitAll().
        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/metadata",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class);

        // 200 proves the static token was accepted (real JWT validator would reject it)
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void valid_static_token_allows_access_to_protected_patient_endpoint() {
        // /fhir/Patient is .anyRequest().authenticated() — not permitAll() — so this test
        // confirms the filter sets a valid SecurityContext that Spring Security 6 honours
        // when the filter is registered inside FilterChainProxy.
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("ci-test-token-abc123");
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Patient",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class);

        // 200 proves the authentication succeeded; a real JWT decoder would reject
        // "ci-test-token-abc123" as an invalid JWT and return 401.
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    /**
     * Wrong token → 401. Combined with TenantIsolationIT (which runs without conformance mode
     * and doesn't accept static tokens), confirms the bypass is property-guarded.
     */
    @Test
    void wrong_static_token_returns_401() {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth("wrong-token");

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Patient",
            HttpMethod.GET,
            new HttpEntity<>(headers),
            String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}

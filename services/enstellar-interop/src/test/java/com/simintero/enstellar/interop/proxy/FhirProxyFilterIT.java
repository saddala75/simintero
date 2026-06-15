package com.simintero.enstellar.interop.proxy;

import com.simintero.enstellar.interop.FhirTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for FhirProxyFilter.
 *
 * <p>Uses the shared {@code HAPI_MOCK} WireMock server from {@link FhirTestBase} as the
 * "external HAPI" target.  The proxy is enabled globally for all integration tests via
 * FhirTestBase's {@code interop.hapi.proxy-enabled=true} property, so these tests simply
 * add the specific stubs they need on top of the base defaults.
 */
class FhirProxyFilterIT extends FhirTestBase {

    @Test
    void post_patient_injects_tenant_security_tag() throws Exception {
        HAPI_MOCK.stubFor(post(urlMatching("/fhir/Patient"))
            .willReturn(aResponse().withStatus(201)
                .withHeader("Content-Type", "application/fhir+json")
                .withBody("{\"resourceType\":\"Patient\",\"id\":\"p1\"}")));

        HttpHeaders headers = fhirHeaders(mintJwt("acme", "patient/*.write"));
        String body = "{\"resourceType\":\"Patient\",\"name\":[{\"family\":\"Test\"}]}";

        restTemplate.exchange("http://localhost:" + port + "/fhir/Patient",
            HttpMethod.POST, new HttpEntity<>(body, headers), String.class);

        HAPI_MOCK.verify(postRequestedFor(urlEqualTo("/fhir/Patient"))
            .withRequestBody(matchingJsonPath(
                "$.meta.security[?(@.system == 'https://enstellar.simintero.com/tenants' " +
                "&& @.code == 'acme')]")));
    }

    @Test
    void get_search_appends_security_param() {
        HAPI_MOCK.stubFor(get(urlMatching("/fhir/Patient.*"))
            .willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/fhir+json")
                .withBody("{\"resourceType\":\"Bundle\",\"entry\":[]}")));

        HttpHeaders headers = fhirHeaders(mintJwt("beta", "patient/*.read"));
        restTemplate.exchange("http://localhost:" + port + "/fhir/Patient?family=Smith",
            HttpMethod.GET, new HttpEntity<>(headers), String.class);

        HAPI_MOCK.verify(getRequestedFor(urlMatching("/fhir/Patient.*"))
            .withQueryParam("_security",
                containing("https://enstellar.simintero.com/tenants|beta")));
    }

    @Test
    void get_read_returns_403_when_resource_belongs_to_different_tenant() {
        HAPI_MOCK.stubFor(get(urlEqualTo("/fhir/Patient/p99"))
            .willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/fhir+json")
                .withBody("""
                    {"resourceType":"Patient","id":"p99",
                     "meta":{"security":[
                       {"system":"https://enstellar.simintero.com/tenants","code":"tenant-a"}
                     ]}}
                    """)));

        HttpHeaders headers = fhirHeaders(mintJwt("tenant-b", "patient/*.read"));
        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Patient/p99",
            HttpMethod.GET, new HttpEntity<>(headers), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void submit_operation_bypasses_proxy() {
        HttpHeaders headers = fhirHeaders(mintJwt("acme", "patient/*.write"));
        String bundle = "{\"resourceType\":\"Bundle\",\"type\":\"collection\",\"entry\":[]}";

        restTemplate.exchange("http://localhost:" + port + "/fhir/Claim/$submit",
            HttpMethod.POST, new HttpEntity<>(bundle, headers), String.class);

        // $submit goes to embedded HAPI op provider — external HAPI mock must NOT receive it
        HAPI_MOCK.verify(0, anyRequestedFor(anyUrl()));
    }

    @Test
    void metadata_is_proxied_to_hapi() {
        HAPI_MOCK.stubFor(get(urlEqualTo("/fhir/metadata"))
            .willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/fhir+json")
                .withBody("{\"resourceType\":\"CapabilityStatement\"}")));

        ResponseEntity<String> response = restTemplate.getForEntity(
            "http://localhost:" + port + "/fhir/metadata", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        HAPI_MOCK.verify(getRequestedFor(urlEqualTo("/fhir/metadata")));
    }

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders h = new HttpHeaders();
        h.setBearerAuth(token);
        h.setContentType(MediaType.valueOf("application/fhir+json"));
        h.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return h;
    }
}

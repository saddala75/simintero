package io.simintero.fhir;

import io.simintero.fhir.config.CapabilityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies that GET /fhir/metadata returns a conformant FHIR R4 CapabilityStatement.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CapabilityStatementTest {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void metadataReturns200() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/fhir/metadata",
                HttpMethod.GET,
                withFhirJsonAccept(),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isNotNull();
    }

    @Test
    void metadataFhirVersionIs4_0_1() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/fhir/metadata",
                HttpMethod.GET,
                withFhirJsonAccept(),
                String.class);

        String body = response.getBody();
        assertThat(body).contains("\"fhirVersion\"");
        assertThat(body).contains("4.0.1");
    }

    @Test
    void metadataContainsClaimResourceEntry() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/fhir/metadata",
                HttpMethod.GET,
                withFhirJsonAccept(),
                String.class);

        // HAPI renders resource types as {"type":"Claim",...}
        assertThat(response.getBody()).contains("\"Claim\"");
    }

    @Test
    void metadataHasNonNullImplementationUrl() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/fhir/metadata",
                HttpMethod.GET,
                withFhirJsonAccept(),
                String.class);

        String body = response.getBody();
        // CapabilityStatement.implementation.url must be present and non-empty
        assertThat(body).contains("\"implementation\"");
        // HardcodedServerAddressStrategy sets url to fhir.implementation.url property
        assertThat(body).contains("\"url\"");
        // The actual URL value must not be the literal string "null"
        assertThat(body).doesNotContain("\"url\":null");
    }

    @Test
    void metadataContainsPasAndUsCoreImplementationGuides() {
        ResponseEntity<String> response = restTemplate.exchange(
                "/fhir/metadata",
                HttpMethod.GET,
                withFhirJsonAccept(),
                String.class);

        String body = response.getBody();
        // CapabilityStatement.implementationGuide must list both Da Vinci PAS and US Core IGs
        assertThat(body).contains(
                "http://hl7.org/fhir/us/davinci-pas/ImplementationGuide/hl7.fhir.us.davinci-pas");
        assertThat(body).contains(
                "http://hl7.org/fhir/us/core/ImplementationGuide/hl7.fhir.us.core");
    }

    // -------------------------------------------------------------------------

    private HttpEntity<Void> withFhirJsonAccept() {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept", "application/fhir+json");
        return new HttpEntity<>(headers);
    }
}

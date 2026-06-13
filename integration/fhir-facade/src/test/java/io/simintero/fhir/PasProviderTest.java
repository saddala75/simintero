package io.simintero.fhir;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Claim;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Identifier;
import org.hl7.fhir.r4.model.Reference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.hamcrest.Matchers.containsString;

/**
 * Integration test for PasProvider.$submit.
 * Uses MockRestServiceServer to intercept the RestTemplate call to the intake service,
 * avoiding a real HTTP dependency while still exercising the full Spring + HAPI stack.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PasProviderTest {

    @Autowired
    private TestRestTemplate testRestTemplate;

    /** The same RestTemplate bean that PasProvider uses — we bind the mock to this */
    @Autowired
    private RestTemplate restTemplate;

    private MockRestServiceServer mockIntakeServer;

    @BeforeEach
    void setUpMock() {
        mockIntakeServer = MockRestServiceServer.bindTo(restTemplate).build();
    }

    @AfterEach
    void verifyMock() {
        mockIntakeServer.verify();
        mockIntakeServer.reset();
    }

    @Test
    void submitReturns200WithOperationOutcome() {
        // Expect the facade to POST IntakeCommand to the intake service
        mockIntakeServer
                .expect(requestTo(containsString("/internal/intake/commands")))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"id\":\"intake-abc123\"}", MediaType.APPLICATION_JSON));

        // POST a FHIR Claim to $submit
        String claimJson = serializeClaim(buildTestClaim());
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/fhir+json");
        headers.set("Accept", "application/fhir+json");

        ResponseEntity<String> response = testRestTemplate.exchange(
                "/fhir/Claim/$submit",
                HttpMethod.POST,
                new HttpEntity<>(claimJson, headers),
                String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);

        String body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body).contains("OperationOutcome");
        assertThat(body).contains("issue");
    }

    @Test
    void submitOperationOutcomeContainsTrackingNote() {
        mockIntakeServer
                .expect(requestTo(containsString("/internal/intake/commands")))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        String claimJson = serializeClaim(buildTestClaim());
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/fhir+json");
        headers.set("Accept", "application/fhir+json");

        ResponseEntity<String> response = testRestTemplate.exchange(
                "/fhir/Claim/$submit",
                HttpMethod.POST,
                new HttpEntity<>(claimJson, headers),
                String.class);

        // OperationOutcome must have at least one issue with the async tracking note
        assertThat(response.getBody()).contains("Tracking ID");
    }

    @Test
    void inquireReturnsNotImplemented() throws Exception {
        // No mock expectation needed — $inquire throws before touching intake service
        String claimJson = serializeClaim(buildTestClaim());
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/fhir+json");
        headers.set("Accept", "application/fhir+json");

        ResponseEntity<String> response = testRestTemplate.exchange(
                "/fhir/Claim/$inquire",
                HttpMethod.POST,
                new HttpEntity<>(claimJson, headers),
                String.class);

        // HAPI maps NotImplementedOperationException → HTTP 501
        assertThat(response.getStatusCode().value()).isEqualTo(501);
    }

    @Test
    void cancelReturnsNotImplemented() throws Exception {
        // No mock expectation needed — $cancel throws before touching intake service
        String claimJson = serializeClaim(buildTestClaim());
        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/fhir+json");
        headers.set("Accept", "application/fhir+json");

        ResponseEntity<String> response = testRestTemplate.exchange(
                "/fhir/Claim/$cancel",
                HttpMethod.POST,
                new HttpEntity<>(claimJson, headers),
                String.class);

        // HAPI maps NotImplementedOperationException → HTTP 501
        assertThat(response.getStatusCode().value()).isEqualTo(501);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private Claim buildTestClaim() {
        Claim claim = new Claim();
        claim.setStatus(Claim.ClaimStatus.ACTIVE);
        claim.setUse(Claim.Use.PREAUTHORIZATION);

        claim.setPatient(new Reference("Patient/pat-001"));

        Claim.InsuranceComponent insurance = new Claim.InsuranceComponent();
        insurance.setSequence(1);
        insurance.setFocal(true);
        insurance.setCoverage(new Reference("Coverage/cov-001"));
        claim.addInsurance(insurance);

        claim.setPriority(new CodeableConcept()
                .addCoding(new Coding().setCode("normal")));

        claim.addIdentifier(new Identifier()
                .setSystem("urn:clearinghouse:id")
                .setValue("REF-999"));

        Claim.ItemComponent item = new Claim.ItemComponent();
        item.setSequence(1);
        item.setProductOrService(new CodeableConcept()
                .addCoding(new Coding()
                        .setSystem("http://www.ama-assn.org/go/cpt")
                        .setCode("27447")));
        claim.addItem(item);

        return claim;
    }

    private String serializeClaim(Claim claim) {
        return FhirContext.forR4().newJsonParser().encodeResourceToString(claim);
    }
}

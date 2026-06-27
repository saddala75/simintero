package com.simintero.enstellar.interop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.proxy.CapabilityStatementAugmenter;
import org.junit.jupiter.api.Test;
import org.springframework.http.*;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

// These tests verify the proxy RELAYS the CapabilityStatement (metadata) to callers.
// Actual FHIR profile-version conformance (US Core 5.0.1 / PAS 2.0.1) is gated by
// `make conformance` (Inferno), not by these assertions.
class CapabilityStatementIT extends FhirTestBase {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void metadata_returns_200_with_CapabilityStatement() throws Exception {
        ResponseEntity<String> response = restTemplate.getForEntity(
            "http://localhost:" + port + "/fhir/metadata", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode cs = JSON.readTree(response.getBody());
        assertThat(cs.path("resourceType").asText()).isEqualTo("CapabilityStatement");
        assertThat(cs.path("status").asText()).isEqualTo("active");
    }

    @Test
    void metadata_declares_us_core_501_patient_profile() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
            "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        String patientProfile = StreamSupport.stream(resources.spliterator(), false)
            .filter(r -> "Patient".equals(r.path("type").asText()))
            .map(r -> r.path("profile").asText())
            .findFirst().orElse("");

        assertThat(patientProfile)
            .isEqualTo("http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|5.0.1");
    }

    @Test
    void metadata_declares_pas_201_coverage_profile() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
            "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        String coverageProfile = StreamSupport.stream(resources.spliterator(), false)
            .filter(r -> "Coverage".equals(r.path("type").asText()))
            .map(r -> r.path("profile").asText())
            .findFirst().orElse("");

        assertThat(coverageProfile)
            .isEqualTo("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-coverage-pas|2.0.1");
    }

    @Test
    void metadata_declares_required_resource_types() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
            "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        Set<String> types = StreamSupport.stream(resources.spliterator(), false)
            .map(r -> r.path("type").asText())
            .collect(Collectors.toSet());

        assertThat(types).containsExactlyInAnyOrder(
            "Patient", "Practitioner", "Coverage", "Organization", "DocumentReference",
            "Claim", "ClaimResponse", "Questionnaire", "QuestionnaireResponse");
    }

    @Test
    void metadata_augments_claim_resource_with_pas_operations() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
            "http://localhost:" + port + "/fhir/metadata", String.class));
        JsonNode resources = cs.path("rest").path(0).path("resource");

        JsonNode claim = StreamSupport.stream(resources.spliterator(), false)
            .filter(r -> "Claim".equals(r.path("type").asText()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("Claim not found in CapabilityStatement resources"));

        assertThat(claim.path("profile").asText())
            .isEqualTo("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");

        Set<String> ops = StreamSupport.stream(claim.path("operation").spliterator(), false)
            .map(o -> o.path("name").asText())
            .collect(Collectors.toSet());
        assertThat(ops).contains("submit", "inquire");
    }

    @Test
    void metadata_augments_implementation_guides() throws Exception {
        JsonNode cs = JSON.readTree(restTemplate.getForObject(
            "http://localhost:" + port + "/fhir/metadata", String.class));

        Set<String> igs = StreamSupport.stream(cs.path("implementationGuide").spliterator(), false)
            .map(JsonNode::asText)
            .collect(Collectors.toSet());

        assertThat(igs).containsAll(CapabilityStatementAugmenter.IMPLEMENTATION_GUIDES);
    }
}

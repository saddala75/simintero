package com.simintero.enstellar.interop.proxy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

class CapabilityStatementAugmenterTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final CapabilityStatementAugmenter augmenter = new CapabilityStatementAugmenter();

    @Test
    void augment_sets_publisher() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        assertThat(result.path("publisher").asText()).isEqualTo("Simintero Enstellar");
    }

    @Test
    void augment_adds_all_implementation_guides() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        Set<String> igs = toSet(result.path("implementationGuide"));
        assertThat(igs).containsExactlyInAnyOrderElementsOf(CapabilityStatementAugmenter.IMPLEMENTATION_GUIDES);
    }

    @Test
    void augment_adds_claim_with_submit_and_inquire_operations() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode claim = resourceByType(result, "Claim");

        assertThat(claim.path("profile").asText())
            .isEqualTo("http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-pas|2.0.1");

        Set<String> ops = toSet(claim.path("operation"), "name");
        assertThat(ops).containsExactlyInAnyOrder("submit", "inquire");
    }

    @Test
    void augment_adds_claimresponse_questionnaire_questionnaireresponse() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode resources = result.path("rest").path(0).path("resource");
        Set<String> types = toSet(resources, "type");
        assertThat(types).contains("ClaimResponse", "Questionnaire", "QuestionnaireResponse");
    }

    @Test
    void augment_preserves_existing_resources() throws Exception {
        JsonNode result = JSON.readTree(augmenter.augment(minimal()));
        JsonNode resources = result.path("rest").path(0).path("resource");
        Set<String> types = toSet(resources, "type");
        assertThat(types).contains("Patient");
    }

    // --- helpers ---

    private static byte[] minimal() {
        return """
            {"resourceType":"CapabilityStatement","status":"active",
             "rest":[{"mode":"server","resource":[{"type":"Patient"}]}]}
            """.getBytes();
    }

    private static JsonNode resourceByType(JsonNode cs, String type) {
        return StreamSupport.stream(cs.path("rest").path(0).path("resource").spliterator(), false)
            .filter(r -> type.equals(r.path("type").asText()))
            .findFirst()
            .orElseThrow(() -> new AssertionError(type + " not found in CapabilityStatement resources"));
    }

    private static Set<String> toSet(JsonNode arrayNode) {
        return StreamSupport.stream(arrayNode.spliterator(), false)
            .map(JsonNode::asText)
            .collect(Collectors.toSet());
    }

    private static Set<String> toSet(JsonNode arrayNode, String field) {
        return StreamSupport.stream(arrayNode.spliterator(), false)
            .map(n -> n.path(field).asText())
            .collect(Collectors.toSet());
    }
}

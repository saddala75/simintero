package com.simintero.enstellar.interop.pas;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.simintero.enstellar.interop.FhirTestBase;
import com.simintero.enstellar.interop.decision.DecisionRecord;
import com.simintero.enstellar.interop.decision.DecisionStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for Claim/$inquire (T11 DecisionStore-based implementation).
 *
 * Pre-populates DecisionRecord rows directly rather than stubbing the workflow-engine REST API
 * (which was the T06 approach — removed in T11).
 */
class PasInquireIT extends FhirTestBase {

    @Autowired
    DecisionStore decisionStore;

    @BeforeEach
    void cleanDecisionStore() {
        decisionStore.deleteAll();
    }

    private HttpHeaders fhirHeaders(String token) {
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);
        headers.setAccept(List.of(MediaType.valueOf("application/fhir+json")));
        return headers;
    }

    private DecisionRecord approvedRecord(String tenantId, String correlationId) {
        DecisionRecord r = new DecisionRecord();
        r.setCaseId(UUID.fromString("550e8400-e29b-41d4-a716-446655440001"));
        r.setTenantId(tenantId);
        r.setCorrelationId(correlationId);
        r.setClaimRef(correlationId);
        r.setOutcome("approved");
        r.setRuleArtifact("policy-v2");
        r.setRuleVersion("2.0.0");
        r.setAutoApproved(true);
        r.setDecidedAt(Instant.now());
        r.setCreatedAt(Instant.now());
        r.setPatientRef("Patient/pat-inquire-001");
        r.setInsurerRef("Organization/payer-inquire-001");
        r.setClaimFhirId("claim-inquire-001");
        return r;
    }

    private DecisionRecord pendingRecord(String tenantId, String correlationId) {
        DecisionRecord r = new DecisionRecord();
        r.setCaseId(UUID.fromString("550e8400-e29b-41d4-a716-446655440002"));
        r.setTenantId(tenantId);
        r.setCorrelationId(correlationId);
        r.setClaimRef(correlationId);
        r.setCreatedAt(Instant.now());
        r.setPatientRef("Patient/pat-inquire-002");
        r.setInsurerRef("Organization/payer-inquire-002");
        r.setClaimFhirId("claim-inquire-002");
        // outcome intentionally left null = pending
        return r;
    }

    @Test
    void inquire_approvedCase_returnsCompleteOutcome() throws Exception {
        String tenantId = "tenant-inquire-approved";
        decisionStore.save(approvedRecord(tenantId, "corr-approved-001"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/corr-approved-001/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(fhirHeaders(mintJwt(tenantId, "patient/*.read"))),
            String.class
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        JsonNode body = new ObjectMapper().readTree(response.getBody());
        JsonNode claimResponse = body.path("entry").path(0).path("resource");
        assertThat(claimResponse.path("outcome").asText()).isEqualTo("complete");
        assertThat(claimResponse.path("patient").path("reference").asText())
                .isEqualTo("Patient/pat-inquire-001");
        assertThat(claimResponse.path("insurer").path("reference").asText())
                .isEqualTo("Organization/payer-inquire-001");
    }

    @Test
    void inquire_pendingCase_returnsQueuedOutcome() throws Exception {
        String tenantId = "tenant-inquire-pending";
        decisionStore.save(pendingRecord(tenantId, "corr-pending-001"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/corr-pending-001/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(fhirHeaders(mintJwt(tenantId, "patient/*.read"))),
            String.class
        );

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        JsonNode body = new ObjectMapper().readTree(response.getBody());
        JsonNode claimResponse = body.path("entry").path(0).path("resource");
        assertThat(claimResponse.path("outcome").asText()).isEqualTo("queued");
        assertThat(claimResponse.path("patient").path("reference").asText())
                .isEqualTo("Patient/pat-inquire-002");
    }

    @Test
    void inquire_unknownCase_returns404() {
        String tenantId = "tenant-inquire-404";

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/corr-not-found/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(fhirHeaders(mintJwt(tenantId, "patient/*.read"))),
            String.class
        );

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void inquire_wrongTenant_returns404() {
        String ownerTenant = "tenant-inquire-owner";
        String wrongTenant = "tenant-inquire-wrong";
        decisionStore.save(approvedRecord(ownerTenant, "corr-cross-tenant-001"));

        ResponseEntity<String> response = restTemplate.exchange(
            "http://localhost:" + port + "/fhir/Claim/corr-cross-tenant-001/$inquire",
            HttpMethod.GET,
            new HttpEntity<>(fhirHeaders(mintJwt(wrongTenant, "patient/*.read"))),
            String.class
        );

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }
}

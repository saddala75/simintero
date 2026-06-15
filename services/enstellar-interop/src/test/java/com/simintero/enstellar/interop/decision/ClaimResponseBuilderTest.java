package com.simintero.enstellar.interop.decision;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for ClaimResponseBuilder — no Spring context needed.
 *
 * Verifies all T11 DoD requirements:
 *   - ClaimResponse.patient and ClaimResponse.insurer satisfy R4 cardinality 1..1
 *   - ClaimResponse.identifier echoes claim_ref (prior-auth tracking number)
 *   - adjudication category = "benefit"
 *   - rule-trace extension = "{artifact}@{version}"
 *   - outcome mapped from record.outcome (not hardcoded)
 *   - pending bundle has outcome = QUEUED
 */
class ClaimResponseBuilderTest {

    private static ClaimResponseBuilder builder;

    @BeforeAll
    static void setup() {
        builder = new ClaimResponseBuilder();
    }

    private DecisionRecord approvedRecord() {
        DecisionRecord r = new DecisionRecord();
        r.setCaseId(UUID.fromString("550e8400-e29b-41d4-a716-446655440001"));
        r.setTenantId("tenant-unit-test");
        r.setCorrelationId("corr-unit-001");
        r.setClaimRef("CLAIM-REF-001");
        r.setOutcome("approved");
        r.setRuleArtifact("policy-v2-2026-q2");
        r.setRuleVersion("2.1.0");
        r.setAutoApproved(true);
        r.setDecidedAt(Instant.parse("2026-06-05T12:00:00Z"));
        r.setCreatedAt(Instant.parse("2026-06-05T11:55:00Z"));
        r.setPatientRef("Patient/pat-unit-001");
        r.setInsurerRef("Organization/payer-unit-001");
        r.setClaimFhirId("claim-unit-001");
        return r;
    }

    private DecisionRecord pendingRecord() {
        DecisionRecord r = new DecisionRecord();
        r.setCaseId(UUID.fromString("550e8400-e29b-41d4-a716-446655440002"));
        r.setTenantId("tenant-unit-test");
        r.setCorrelationId("corr-pending-001");
        r.setClaimRef("CLAIM-PENDING-001");
        r.setCreatedAt(Instant.now());
        r.setPatientRef("Patient/pat-unit-002");
        r.setInsurerRef("Organization/payer-unit-002");
        r.setClaimFhirId("claim-unit-002");
        // outcome intentionally null = pending
        return r;
    }

    @Test
    void buildBundle_returnsCollectionBundleWithOneClaimResponse() {
        Bundle bundle = builder.buildBundle(approvedRecord());

        assertThat(bundle.getType()).isEqualTo(Bundle.BundleType.COLLECTION);
        assertThat(bundle.getEntry()).hasSize(1);
        assertThat(bundle.getEntryFirstRep().getResource()).isInstanceOf(ClaimResponse.class);
    }

    @Test
    void buildBundle_claimResponseIdentifier_echoesClaimRef() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getIdentifier()).isNotEmpty();
        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo("CLAIM-REF-001");
        assertThat(cr.getIdentifierFirstRep().getSystem())
                .isEqualTo("https://enstellar.simintero.com/auth-tracking");
    }

    @Test
    void buildBundle_outcome_isComplete_forApproved() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.COMPLETE);
    }

    @Test
    void buildBundle_outcome_isError_forDenied() {
        DecisionRecord r = approvedRecord();
        r.setOutcome("denied");
        ClaimResponse cr = (ClaimResponse) builder.buildBundle(r).getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.ERROR);
    }

    @Test
    void buildBundle_outcome_isQueued_forUnknownOutcome() {
        DecisionRecord r = approvedRecord();
        r.setOutcome("clinical_review");
        ClaimResponse cr = (ClaimResponse) builder.buildBundle(r).getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.QUEUED);
    }

    @Test
    void buildBundle_use_isPreauthorization() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
    }

    @Test
    void buildBundle_patient_and_insurer_present() {
        ClaimResponse cr = (ClaimResponse) builder.buildBundle(approvedRecord())
                .getEntryFirstRep().getResource();

        assertThat(cr.getPatient().getReference()).isEqualTo("Patient/pat-unit-001");
        assertThat(cr.getInsurer().getReference()).isEqualTo("Organization/payer-unit-001");
        assertThat(cr.getRequest().getReference()).isEqualTo("Claim/claim-unit-001");
    }

    @Test
    void buildBundle_fallback_patient_insurer_when_refs_absent() {
        DecisionRecord r = approvedRecord();
        r.setPatientRef(null);
        r.setInsurerRef(null);
        ClaimResponse cr = (ClaimResponse) builder.buildBundle(r)
                .getEntryFirstRep().getResource();

        assertThat(cr.getPatient()).isNotNull();
        assertThat(cr.getInsurer()).isNotNull();
    }

    @Test
    void buildBundle_adjudication_categoryIsBenefit() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getItem()).isNotEmpty();
        ClaimResponse.AdjudicationComponent adj = cr.getItemFirstRep().getAdjudicationFirstRep();
        assertThat(adj.getCategory().getCodingFirstRep().getSystem())
                .isEqualTo("http://terminology.hl7.org/CodeSystem/adjudication");
        assertThat(adj.getCategory().getCodingFirstRep().getCode()).isEqualTo("benefit");
    }

    @Test
    void buildBundle_ruleTraceExtension_containsArtifactAtVersion() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        var traceExt = cr.getExtension().stream()
                .filter(e -> e.getUrl().equals(ClaimResponseBuilder.RULE_TRACE_EXT))
                .findFirst();
        assertThat(traceExt).isPresent();
        assertThat(traceExt.get().getValue().toString()).isEqualTo("policy-v2-2026-q2@2.1.0");
    }

    @Test
    void buildBundle_caseIdExtension_present() {
        Bundle bundle = builder.buildBundle(approvedRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        var caseIdExt = cr.getExtension().stream()
                .filter(e -> e.getUrl().equals(ClaimResponseBuilder.CASE_ID_EXT))
                .findFirst();
        assertThat(caseIdExt).isPresent();
        assertThat(caseIdExt.get().getValue().toString())
                .isEqualTo("550e8400-e29b-41d4-a716-446655440001");
    }

    @Test
    void buildPendingBundle_outcome_isQueued() {
        Bundle bundle = builder.buildPendingBundle(pendingRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getOutcome()).isEqualTo(ClaimResponse.RemittanceOutcome.QUEUED);
        assertThat(cr.getUse()).isEqualTo(ClaimResponse.Use.PREAUTHORIZATION);
    }

    @Test
    void buildPendingBundle_claimRefEchoed() {
        Bundle bundle = builder.buildPendingBundle(pendingRecord());
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        assertThat(cr.getIdentifierFirstRep().getValue()).isEqualTo("CLAIM-PENDING-001");
    }

    @Test
    void buildPendingBundle_patient_and_insurer_present() {
        ClaimResponse cr = (ClaimResponse) builder.buildPendingBundle(pendingRecord())
                .getEntryFirstRep().getResource();

        assertThat(cr.getPatient().getReference()).isEqualTo("Patient/pat-unit-002");
        assertThat(cr.getInsurer().getReference()).isEqualTo("Organization/payer-unit-002");
    }

    @Test
    void buildBundle_nullRuleArtifact_noTraceExtension() {
        DecisionRecord r = approvedRecord();
        r.setRuleArtifact(null);
        r.setRuleVersion(null);

        Bundle bundle = builder.buildBundle(r);
        ClaimResponse cr = (ClaimResponse) bundle.getEntryFirstRep().getResource();

        boolean hasTrace = cr.getExtension().stream()
                .anyMatch(e -> e.getUrl().equals(ClaimResponseBuilder.RULE_TRACE_EXT));
        assertThat(hasTrace).isFalse();
    }
}

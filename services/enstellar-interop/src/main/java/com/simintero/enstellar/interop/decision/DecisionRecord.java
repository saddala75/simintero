package com.simintero.enstellar.interop.decision;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA entity for the decision_store table.
 *
 * Two-phase lifecycle:
 *   Phase 1 — Created by PasClaimSubmitProvider at $submit time.
 *             outcome IS NULL (= pending, decision in flight).
 *             Stores claim_ref (Claim.identifier) for tracking number.
 *
 *   Phase 2 — Updated by DecisionEventConsumer on decision.recorded.
 *             outcome IS NOT NULL (= approved / pending_review / etc.).
 *             rule_artifact, rule_version, auto_approved, decided_at filled in.
 *
 * INVARIANT #5: tenant_id is NON-NULL and is propagated to every DB query
 * that touches this table.
 */
@Entity
@Table(name = "decision_store")
public class DecisionRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** UUID of the canonical case created by the workflow-engine. */
    @Column(name = "case_id", columnDefinition = "uuid")
    private UUID caseId;

    /** Tenant that owns this case. Never null after creation. */
    @Column(name = "tenant_id", nullable = false)
    private String tenantId;

    /**
     * Correlation ID: the Bundle.id used as the external tracking ID for this submission.
     * Used as the path parameter in $inquire: GET /fhir/Claim/{correlationId}/$inquire
     */
    @Column(name = "correlation_id", nullable = false)
    private String correlationId;

    /**
     * Prior-auth tracking number echoed back in ClaimResponse.identifier.
     * Extracted from Claim.identifier at $submit time; falls back to correlationId.
     */
    @Column(name = "claim_ref", nullable = false)
    private String claimRef;

    /**
     * Outcome from decision.recorded — null while decision is in flight.
     * Expected values: "approved" (P0 auto path); future: "clinical_review", etc.
     */
    @Column(name = "outcome")
    private String outcome;

    /** Digicore rule artifact ID — set when decision.recorded arrives. */
    @Column(name = "rule_artifact")
    private String ruleArtifact;

    /** Digicore rule version — set when decision.recorded arrives. */
    @Column(name = "rule_version")
    private String ruleVersion;

    /** Whether the decision was made automatically (no human sign-off). */
    @Column(name = "auto_approved")
    private Boolean autoApproved;

    /** Timestamp of the decision — from EventEnvelope.occurred_at. */
    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** FHIR Reference string for ClaimResponse.patient (e.g. "Patient/pat-001"). */
    @Column(name = "patient_ref")
    private String patientRef;

    /** FHIR Reference string for ClaimResponse.insurer (e.g. "Organization/payer-001"). */
    @Column(name = "insurer_ref")
    private String insurerRef;

    /** Claim FHIR logical ID for ClaimResponse.request (e.g. "claim-001"). */
    @Column(name = "claim_fhir_id")
    private String claimFhirId;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) this.createdAt = Instant.now();
    }

    // -----------------------------------------------------------------------
    // Getters and setters
    // -----------------------------------------------------------------------

    public Long getId() { return id; }

    public UUID getCaseId() { return caseId; }
    public void setCaseId(UUID caseId) { this.caseId = caseId; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public String getCorrelationId() { return correlationId; }
    public void setCorrelationId(String correlationId) { this.correlationId = correlationId; }

    public String getClaimRef() { return claimRef; }
    public void setClaimRef(String claimRef) { this.claimRef = claimRef; }

    public String getOutcome() { return outcome; }
    public void setOutcome(String outcome) { this.outcome = outcome; }

    public String getRuleArtifact() { return ruleArtifact; }
    public void setRuleArtifact(String ruleArtifact) { this.ruleArtifact = ruleArtifact; }

    public String getRuleVersion() { return ruleVersion; }
    public void setRuleVersion(String ruleVersion) { this.ruleVersion = ruleVersion; }

    public Boolean getAutoApproved() { return autoApproved; }
    public void setAutoApproved(Boolean autoApproved) { this.autoApproved = autoApproved; }

    public Instant getDecidedAt() { return decidedAt; }
    public void setDecidedAt(Instant decidedAt) { this.decidedAt = decidedAt; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public String getPatientRef() { return patientRef; }
    public void setPatientRef(String patientRef) { this.patientRef = patientRef; }

    public String getInsurerRef() { return insurerRef; }
    public void setInsurerRef(String insurerRef) { this.insurerRef = insurerRef; }

    public String getClaimFhirId() { return claimFhirId; }
    public void setClaimFhirId(String claimFhirId) { this.claimFhirId = claimFhirId; }
}

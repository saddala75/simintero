package com.simintero.enstellar.interop.decision;

import org.hl7.fhir.r4.model.Bundle;
import org.hl7.fhir.r4.model.ClaimResponse;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.StringType;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * Builds a HAPI FHIR R4 ClaimResponse + Bundle from a completed or pending DecisionRecord.
 *
 * DoD requirements enforced by this class:
 *   1. ClaimResponse.patient and ClaimResponse.insurer satisfy R4 cardinality 1..1.
 *   2. ClaimResponse.identifier echoes Claim.identifier (claim_ref) as prior-auth tracking number.
 *   3. adjudication category = "benefit" (http://terminology.hl7.org/CodeSystem/adjudication).
 *   4. Provenance extension "rule-trace" = "{rule_artifact}@{rule_version}" makes the
 *      decision trace reproducible from the event history.
 *   5. outcome mapped from DecisionRecord.outcome string (not hardcoded to COMPLETE).
 *   6. use = PREAUTHORIZATION.
 */
@Component
public class ClaimResponseBuilder {

    static final String RULE_TRACE_EXT =
            "https://enstellar.simintero.com/fhir/StructureDefinition/rule-trace";
    static final String CASE_ID_EXT =
            "https://enstellar.simintero.com/fhir/StructureDefinition/case-id";
    static final String AUTH_TRACKING_SYSTEM =
            "https://enstellar.simintero.com/auth-tracking";
    private static final String ADJUDICATION_SYSTEM =
            "http://terminology.hl7.org/CodeSystem/adjudication";

    /**
     * Build a Bundle containing a completed ClaimResponse from a DecisionRecord.
     * Called by PasClaimInquireProvider when outcome is non-null.
     */
    public Bundle buildBundle(DecisionRecord record) {
        ClaimResponse cr = buildClaimResponse(record);
        Bundle bundle = new Bundle();
        bundle.setId(UUID.randomUUID().toString());
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.setTimestamp(Date.from(Instant.now()));
        bundle.addEntry().setResource(cr);
        return bundle;
    }

    /**
     * Build a Bundle containing a pending ClaimResponse (decision in flight).
     * Called by PasClaimInquireProvider when outcome IS NULL.
     *
     * Uses patient_ref and insurer_ref stored at $submit time to satisfy R4 cardinality 1..1.
     */
    public Bundle buildPendingBundle(DecisionRecord record) {
        ClaimResponse cr = new ClaimResponse();
        cr.setId(UUID.randomUUID().toString());
        cr.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        cr.setOutcome(ClaimResponse.RemittanceOutcome.QUEUED);
        cr.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        cr.setCreated(Date.from(Instant.now()));

        cr.addIdentifier()
                .setSystem(AUTH_TRACKING_SYSTEM)
                .setValue(record.getClaimRef() != null
                        ? record.getClaimRef() : record.getCorrelationId());

        setPatient(cr, record.getPatientRef());
        setInsurer(cr, record.getInsurerRef());

        if (record.getClaimFhirId() != null && !record.getClaimFhirId().isBlank()) {
            cr.setRequest(new Reference("Claim/" + record.getClaimFhirId()));
        }

        Bundle bundle = new Bundle();
        bundle.setId(UUID.randomUUID().toString());
        bundle.setType(Bundle.BundleType.COLLECTION);
        bundle.setTimestamp(Date.from(Instant.now()));
        bundle.addEntry().setResource(cr);
        return bundle;
    }

    // -----------------------------------------------------------------------

    ClaimResponse buildClaimResponse(DecisionRecord record) {
        ClaimResponse cr = new ClaimResponse();
        cr.setId(UUID.randomUUID().toString());
        cr.setStatus(ClaimResponse.ClaimResponseStatus.ACTIVE);
        cr.setOutcome(mapOutcome(record.getOutcome()));
        cr.setUse(ClaimResponse.Use.PREAUTHORIZATION);
        cr.setCreated(record.getDecidedAt() != null
                ? Date.from(record.getDecidedAt())
                : Date.from(Instant.now()));

        // DoD: echo Claim.identifier as prior-auth tracking number
        cr.addIdentifier()
                .setSystem(AUTH_TRACKING_SYSTEM)
                .setValue(record.getClaimRef());

        // R4 cardinality 1..1
        setPatient(cr, record.getPatientRef());
        setInsurer(cr, record.getInsurerRef());

        if (record.getClaimFhirId() != null && !record.getClaimFhirId().isBlank()) {
            cr.setRequest(new Reference("Claim/" + record.getClaimFhirId()));
        }

        // DoD: adjudication with category=benefit
        cr.addItem()
                .setItemSequence(1)
                .addAdjudication()
                .setCategory(new CodeableConcept(
                        new Coding(ADJUDICATION_SYSTEM, "benefit", "Benefit Amount")));

        // DoD: provenance extension — links to exact rule artifact + version
        if (record.getRuleArtifact() != null && record.getRuleVersion() != null) {
            cr.addExtension()
                    .setUrl(RULE_TRACE_EXT)
                    .setValue(new StringType(
                            record.getRuleArtifact() + "@" + record.getRuleVersion()));
        }

        if (record.getCaseId() != null) {
            cr.addExtension()
                    .setUrl(CASE_ID_EXT)
                    .setValue(new StringType(record.getCaseId().toString()));
        }

        return cr;
    }

    // -----------------------------------------------------------------------

    private static ClaimResponse.RemittanceOutcome mapOutcome(String outcome) {
        if (outcome == null) return ClaimResponse.RemittanceOutcome.QUEUED;
        return switch (outcome.toLowerCase()) {
            case "approved" -> ClaimResponse.RemittanceOutcome.COMPLETE;
            case "denied" -> ClaimResponse.RemittanceOutcome.ERROR;
            default -> ClaimResponse.RemittanceOutcome.QUEUED;
        };
    }

    private static void setPatient(ClaimResponse cr, String patientRef) {
        if (patientRef != null && !patientRef.isBlank()) {
            cr.setPatient(new Reference(patientRef));
        } else {
            cr.setPatient(new Reference().setDisplay("Patient"));
        }
    }

    private static void setInsurer(ClaimResponse cr, String insurerRef) {
        if (insurerRef != null && !insurerRef.isBlank()) {
            cr.setInsurer(new Reference(insurerRef));
        } else {
            cr.setInsurer(new Reference().setDisplay("Payer"));
        }
    }
}

package io.simintero.fhir.pas;

import java.util.List;

/**
 * Canonical wire envelope posted to the Enstellar intake service.
 * All FHIR-specific types are extracted in PasMapper; this record
 * contains only plain Java types so it can be serialized to JSON
 * and consumed by any downstream service regardless of FHIR version.
 *
 * NOTE: No PHI is logged from this record. rawPayloadRef is a
 * base64-encoded payload reference, not plaintext clinical data.
 */
public record IntakeCommand(
        /** Always "PAS" for this channel */
        String channel,

        /** Null for new submissions; set when re-submitting a known case */
        String caseRef,

        /** Object-store reference. Format: "raw:<base64>" for Phase 1 */
        String payloadRef,

        /** Same as payloadRef for Phase 1 */
        String rawPayloadRef,

        /** ISO-8601 UTC timestamp of receipt */
        String receivedAt,

        /** Claim.patient reference, e.g. "Patient/pat-001" */
        String memberRef,

        /** Claim.insurance[0].coverage reference, e.g. "Coverage/cov-001" */
        String coverageRef,

        /** Requesting and servicing NPIs (may be null in Phase 1) */
        Providers providers,

        /** One entry per Claim.item */
        List<ServiceLine> serviceLines,

        /** "standard" | "expedited" derived from Claim.priority */
        String urgency,

        /** Claim.identifier entries */
        List<ExternalId> externalIds
) {

    /** Requesting and servicing provider NPIs. */
    public record Providers(String requestingNpi, String servicingNpi) {}

    /** A single service line item from Claim.item. */
    public record ServiceLine(String code, String system, Integer quantity) {}

    /** A Claim.identifier entry. */
    public record ExternalId(String system, String value) {}
}

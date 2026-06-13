package io.simintero.x12.model;

import java.util.List;

/**
 * Canonical wire envelope for an X12 278 prior-authorization request.
 * Defined independently of the FHIR facade — no cross-integration imports.
 *
 * NOTE: No PHI is logged from this record. rawPayloadRef is a
 * base64-encoded payload reference, not plaintext clinical data.
 */
public record IntakeCommand(
        /** Always "X12_278" for this channel */
        String channel,

        /** Null for new submissions; set when re-submitting a known case */
        String caseRef,

        /** Object-store reference. Format: "raw:<base64>" for Phase 1 */
        String rawPayloadRef,

        /** ISO-8601 UTC timestamp of receipt */
        String receivedAt,

        /** Member identifier, e.g. "member:M123456789" */
        String memberRef,

        /** Coverage identifier, e.g. "coverage:COV-001" */
        String coverageRef,

        /** Requesting and servicing provider NPIs */
        Providers providers,

        /** One entry per SV1 service line */
        List<ServiceLine> serviceLines,

        /** "standard" | "expedited" derived from BHT06 */
        String urgency,

        /** BHT03 and other external identifiers */
        List<ExternalId> externalIds
) {

    /** Requesting and servicing provider NPIs. */
    public record Providers(String requestingNpi, String servicingNpi) {}

    /** A single service line item from an SV1 segment. */
    public record ServiceLine(String code, String system, Integer quantity) {}

    /** An external identifier entry (e.g. BHT03 reference). */
    public record ExternalId(String system, String value) {}
}

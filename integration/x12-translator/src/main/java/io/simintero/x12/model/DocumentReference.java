package io.simintero.x12.model;

/**
 * Minimal FHIR-like record representing an X12 275 additional documentation attachment.
 * TRN02 value from the X12 275 is captured in trnLinkage for correlation.
 *
 * NOTE: rawPayloadRef is a base64-encoded reference — no PHI is stored in this record directly.
 */
public record DocumentReference(
        /** Unique document identifier (generated or derived) */
        String docId,

        /** Case reference derived from NM1*41 NM109; "case:unknown" if absent */
        String caseRef,

        /** MIME type of the content; always "application/x12-275" for this translator */
        String contentType,

        /** Object-store reference. Format: "raw:<base64>" for Phase 1 */
        String rawPayloadRef,

        /** TRN segment linkage for correlating the 275 to a prior 278 */
        TrnLinkage trnLinkage
) {

    /**
     * Encapsulates the TRN segment correlation identifier.
     * system is always "x12-275-trn"; value is the TRN02 element.
     */
    public record TrnLinkage(String system, String value) {}
}

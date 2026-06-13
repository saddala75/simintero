package io.simintero.x12.model;

import java.util.List;

/**
 * Canonical determination result used as input to the X12 278 response serializer.
 * Phase 1 stub — serialization returns a placeholder X12 interchange.
 */
public record DeterminationResult(
        /** Case reference from the originating IntakeCommand */
        String caseRef,

        /** Overall outcome, e.g. "approved", "denied", "pended" */
        String outcome,

        /** Free-text rationale for the determination */
        String rationale,

        /** Per-service-line determination entries */
        List<PerLine> perLine
) {

    /** Per-service-line determination detail. */
    public record PerLine(String lineCode, String lineOutcome) {}
}

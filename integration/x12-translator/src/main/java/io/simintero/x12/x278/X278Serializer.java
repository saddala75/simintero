package io.simintero.x12.x278;

import io.simintero.x12.model.DeterminationResult;
import org.springframework.stereotype.Component;

/**
 * Serializes a canonical {@link DeterminationResult} into an X12 278 response interchange.
 *
 * Phase 1 stub: returns a placeholder X12 interchange string.
 * Full ISA/GS/ST/UM/HI envelope generation is deferred to Phase 1B.
 */
@Component
public class X278Serializer {

    /** Placeholder X12 stub returned for all Phase 1 determinations. */
    static final String STUB_RESPONSE = "ISA*stub~";

    /**
     * Converts a determination result to an X12 278 response text.
     *
     * @param result the canonical determination result
     * @return X12 278 response string; Phase 1 returns the stub placeholder
     */
    public String serialize(DeterminationResult result) {
        // Phase 1 stub — full EDI envelope construction is Phase 1B
        return STUB_RESPONSE;
    }
}

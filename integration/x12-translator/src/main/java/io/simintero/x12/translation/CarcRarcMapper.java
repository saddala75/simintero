package io.simintero.x12.translation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Maps CARC (Claim Adjustment Reason Code) and RARC (Remittance Advice Remark Code)
 * codes to human-readable descriptions via the VKAS concept_map artifact.
 *
 * Phase 1 stub: returns the input code as-is.
 * Phase 1B will activate the VKAS lookup using the version pinned in TranslationContext.
 */
public class CarcRarcMapper {

    private static final Logger log = LoggerFactory.getLogger(CarcRarcMapper.class);

    /**
     * Maps a CARC or RARC code to its description.
     *
     * @param code the CARC or RARC code (e.g. "CO-97", "N130")
     * @return the human-readable description, or the input code if no mapping found
     */
    public static String map(String code) {
        // Phase 1 stub: VKAS concept_map lookup is not yet active.
        // Log only the code identifier — no PHI flows through here.
        log.debug("CARC/RARC map called for code: {}", code);
        return code;
    }
}

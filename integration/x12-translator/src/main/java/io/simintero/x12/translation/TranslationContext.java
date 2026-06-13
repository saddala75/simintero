package io.simintero.x12.translation;

/**
 * Holds the pinned concept_map version used for CARC/RARC code translation.
 *
 * Phase 1 stub: version is hardcoded to "1.0.0-stub".
 * Phase 1B will activate the VKAS concept_map lookup and replace this class.
 */
public class TranslationContext {

    private static final String STUB_VERSION = "1.0.0-stub";

    /**
     * Returns the concept_map version in use.
     * Phase 1 returns the stub sentinel "1.0.0-stub".
     */
    public String conceptMapVersion() {
        return STUB_VERSION;
    }
}

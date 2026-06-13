package io.simintero.fhir.crd;

import org.springframework.stereotype.Component;

/**
 * CRD mapper stub — Phase 1B will implement CDS Hooks card population.
 * Returns null to signal "no cards" for all hook types in Phase 1.
 */
@Component
public class CrdMapper {

    /**
     * Maps a raw CDS Hooks request body to a CDS Hooks response.
     * Phase 1 stub — always returns null (no cards).
     *
     * @param hookRequest raw request body (unused in Phase 1)
     * @return null (Phase 1 stub)
     */
    public Object map(Object hookRequest) {
        return null;
    }
}

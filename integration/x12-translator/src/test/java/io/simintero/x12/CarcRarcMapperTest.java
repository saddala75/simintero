package io.simintero.x12;

import io.simintero.x12.translation.CarcRarcMapper;
import io.simintero.x12.translation.TranslationContext;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the Phase 1 stub CARC/RARC mapper and TranslationContext.
 */
class CarcRarcMapperTest {

    @Test
    void returnsCodeAsIsInPhase1Stub() {
        String code = "CO-97";
        String result = CarcRarcMapper.map(code);
        assertEquals(code, result,
                "Phase 1 stub should return the input code unchanged");
    }

    @Test
    void contextHasStubVersion() {
        TranslationContext ctx = new TranslationContext();
        assertEquals("1.0.0-stub", ctx.conceptMapVersion(),
                "Phase 1 concept_map version should be '1.0.0-stub'");
    }
}

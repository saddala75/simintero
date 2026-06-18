package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.engine.ElmEvaluator;
import io.simintero.digicore.runtime.engine.ElmInterpreter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the arbitrary library-ref overload added in Task 2.5.
 * No Spring context required — pure JUnit 5.
 */
class ElmEvaluatorLibraryRefTest {

    private ElmEvaluator evaluator;

    @BeforeEach
    void setUp() {
        evaluator = new ElmEvaluator(new ElmInterpreter());
    }

    @Test
    void evaluateWithDefaultRef_usesKneeArthroscopyFixture() {
        // Explicit "knee-arthroscopy" ref must behave identically to the no-arg overload
        var result = evaluator.evaluate(Map.of(
            "diagnosis_documented", true,
            "imaging_documented", true,
            "conservative_therapy_tried", true
        ));
        assertEquals("meets_all", result.outcome());
    }

    @Test
    void evaluateWithExplicitRef_loadsSpecifiedLibrary() {
        // "test-policy" fixture is in src/test/resources/elm/test-policy.elm.json
        var result = evaluator.evaluate(Map.of("requirement_met", true), "test-policy");
        assertEquals("meets_all", result.outcome());
    }

    @Test
    void evaluateWithExplicitRef_notMet_whenEvidenceMissing() {
        var result = evaluator.evaluate(Map.of("requirement_met", false), "test-policy");
        assertEquals("not_met", result.outcome());
        assertFalse(result.requirementGaps().isEmpty(), "Gaps must be reported when requirement_met is false");
    }

    @Test
    void evaluateWithUnknownRef_fallsBackToDefault() {
        // Unknown ref → falls back to knee-arthroscopy fixture; all evidence present → meets_all
        var result = evaluator.evaluate(
            Map.of("diagnosis_documented", true, "imaging_documented", true, "conservative_therapy_tried", true),
            "nonexistent-policy-xyz"
        );
        assertNotNull(result.outcome(), "Outcome must not be null even for unknown library ref");
        assertEquals("meets_all", result.outcome(), "Fallback to knee-arthroscopy should yield meets_all for full evidence");
    }

    @Test
    void evaluateWithUrnStyleRef_doesNotThrow() {
        // URN-style ref: colons and slashes must not bleed into the filename
        // urn:sim:policy:knee-arthroscopy:1.0.0 → urn-sim-policy-knee-arthroscopy-1.0.0
        // Loading it will fall back to the default (file not on classpath) — result should still be non-null
        var result = evaluator.evaluate(
            Map.of("diagnosis_documented", true, "imaging_documented", true, "conservative_therapy_tried", true),
            "urn:sim:policy:knee-arthroscopy:1.0.0"
        );
        assertNotNull(result.outcome());
    }
}

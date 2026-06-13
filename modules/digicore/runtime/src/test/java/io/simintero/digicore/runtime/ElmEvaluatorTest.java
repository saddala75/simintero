package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.engine.ElmEvaluator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the Phase 1 lightweight ELM evaluator.
 * No Spring context required — pure JUnit 5.
 */
class ElmEvaluatorTest {

    private ElmEvaluator evaluator;

    @BeforeEach
    void setUp() {
        evaluator = new ElmEvaluator();
    }

    @Test
    void testCaseA_meetsAll() {
        Map<String, Object> evidence = Map.of(
                "diagnosis_documented", true,
                "conservative_therapy_tried", true,
                "imaging_documented", true
        );

        ElmEvaluator.ElmResult result = evaluator.evaluate(evidence);

        assertEquals("meets_all", result.outcome(), "All criteria met should yield meets_all");
        assertTrue(result.requirementGaps().isEmpty(), "No requirement gaps expected when all criteria are met");
    }

    @Test
    void testCaseB_imagingMissing() {
        Map<String, Object> evidence = Map.of(
                "diagnosis_documented", true,
                "conservative_therapy_tried", true,
                "imaging_documented", false
        );

        ElmEvaluator.ElmResult result = evaluator.evaluate(evidence);

        assertEquals("not_met", result.outcome(), "Missing imaging should yield not_met");
        assertFalse(result.requirementGaps().isEmpty(), "Requirement gaps should be non-empty");

        boolean hasImagingGap = result.requirementGaps().stream()
                .anyMatch(gap -> "imaging_documented".equals(gap.get("requirement_id"))
                        && Boolean.TRUE.equals(gap.get("blocking")));
        assertTrue(hasImagingGap, "requirementGaps must contain {requirement_id: imaging_documented, blocking: true}");
    }

    @Test
    void testCaseC_indeterminate() {
        Map<String, Object> evidence = Map.of(
                "diagnosis_documented", true,
                "conservative_therapy_tried", "indeterminate",
                "imaging_documented", true
        );

        ElmEvaluator.ElmResult result = evaluator.evaluate(evidence);

        assertEquals("indeterminate", result.outcome(),
                "Indeterminate evidence value should propagate to indeterminate outcome");
    }
}

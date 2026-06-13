package io.simintero.digicore.runtime;

import io.simintero.digicore.runtime.engine.ElmEvaluator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Verifies the determinism contract:
 *   Identical (request body + pins) MUST return byte-identical outcome, requirementGaps, and logicPath.
 *
 * Pure JUnit 5 — no Spring context needed.
 */
class DeterminismTest {

    private ElmEvaluator evaluator;

    @BeforeEach
    void setUp() {
        evaluator = new ElmEvaluator();
    }

    @Test
    void identicalEvidenceProducesIdenticalOutcomeAndLogicPath() {
        Map<String, Object> evidence = Map.of(
                "diagnosis_documented", true,
                "conservative_therapy_tried", true,
                "imaging_documented", true
        );

        ElmEvaluator.ElmResult first = evaluator.evaluate(evidence);
        ElmEvaluator.ElmResult second = evaluator.evaluate(evidence);

        // Outcome must be byte-identical
        assertEquals(first.outcome(), second.outcome(),
                "Repeated evaluation with identical evidence must yield identical outcome");

        // logicPath must be identical (same expressions, same results)
        assertEquals(first.logicPath().size(), second.logicPath().size(),
                "logicPath length must be identical across calls");

        for (int i = 0; i < first.logicPath().size(); i++) {
            Map<String, Object> step1 = first.logicPath().get(i);
            Map<String, Object> step2 = second.logicPath().get(i);
            assertEquals(step1.get("expression_name"), step2.get("expression_name"),
                    "expression_name at index " + i + " must match");
            assertEquals(step1.get("result"), step2.get("result"),
                    "result at index " + i + " must match");
        }
    }

    @Test
    void identicalEvidenceWithNotMetProducesIdenticalGaps() {
        Map<String, Object> evidence = Map.of(
                "diagnosis_documented", true,
                "conservative_therapy_tried", false,
                "imaging_documented", false
        );

        ElmEvaluator.ElmResult first = evaluator.evaluate(evidence);
        ElmEvaluator.ElmResult second = evaluator.evaluate(evidence);

        assertEquals(first.outcome(), second.outcome());
        assertEquals(first.requirementGaps(), second.requirementGaps(),
                "requirementGaps must be identical across repeated calls with same evidence");
    }
}

package io.simintero.digicore.runtime.engine;

import org.junit.jupiter.api.Test;
import java.util.HashMap;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class KneeRoundTripTest {

    private final ElmEvaluator evaluator = new ElmEvaluator(new ElmInterpreter());

    @Test
    void allEvidenceTrueMeetsAll() {
        var r = evaluator.evaluate(Map.of(
            "diagnosis_documented", true,
            "conservative_therapy_tried", true,
            "imaging_documented", true));
        assertEquals("meets_all", r.outcome());
        assertTrue(r.requirementGaps().isEmpty());
    }

    @Test
    void imagingMissingNotMetWithGap() {
        var r = evaluator.evaluate(Map.of(
            "diagnosis_documented", true,
            "conservative_therapy_tried", true,
            "imaging_documented", false));
        assertEquals("not_met", r.outcome());
        assertTrue(r.requirementGaps().stream()
            .anyMatch(g -> "imaging_documented".equals(g.get("requirement_id"))));
    }

    @Test
    void absentEvidenceIndeterminate() {
        Map<String,Object> ev = new HashMap<>();
        ev.put("diagnosis_documented", true);
        ev.put("imaging_documented", true);
        // conservative_therapy_tried absent → null → Kleene And → indeterminate
        assertEquals("indeterminate", evaluator.evaluate(ev).outcome());
    }
}

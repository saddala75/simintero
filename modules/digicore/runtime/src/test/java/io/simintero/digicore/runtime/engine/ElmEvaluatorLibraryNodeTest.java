package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ElmEvaluatorLibraryNodeTest {
    private final ElmEvaluator evaluator = new ElmEvaluator(new ElmInterpreter());

    private static final String CQL = """
        library Mri version '1.0.0'
        parameter "a" Boolean
        parameter "b" Boolean
        define "Meets All Criteria": "a" and "b"
        """;

    private JsonNode elm() {
        var out = new CqlCompilerService().compile(CQL);
        return ((CqlCompilerService.CompileSuccess) out).elmJson();
    }

    @Test void evaluatesPassedLibraryMeetsAll() {
        assertEquals("meets_all", evaluator.evaluate(Map.of("a", true, "b", true), elm()).outcome());
    }
    @Test void evaluatesPassedLibraryNotMet() {
        assertEquals("not_met", evaluator.evaluate(Map.of("a", true, "b", false), elm()).outcome());
    }
    @Test void evaluatesPassedLibraryIndeterminate() {
        assertEquals("indeterminate", evaluator.evaluate(Map.of("a", true), elm()).outcome()); // b absent
    }
}

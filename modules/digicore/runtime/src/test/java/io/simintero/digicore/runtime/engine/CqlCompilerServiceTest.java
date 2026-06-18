package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CqlCompilerServiceTest {

    private final CqlCompilerService service = new CqlCompilerService();

    private static final String KNEE_CQL = """
        library KneeArthroscopy version '1.0.0'
        parameter "diagnosis_documented" Boolean
        parameter "conservative_therapy_tried" Boolean
        parameter "imaging_documented" Boolean
        define "Diagnosis Documented": "diagnosis_documented"
        define "Conservative Therapy Tried": "conservative_therapy_tried"
        define "Imaging Documented": "imaging_documented"
        define "Meets All Criteria":
          "Diagnosis Documented" and "Conservative Therapy Tried" and "Imaging Documented"
        """;

    @Test
    void compilesKneeCqlToElmWithAllDefs() {
        CqlCompilerService.CompileOutcome out = service.compile(KNEE_CQL);
        assertInstanceOf(CqlCompilerService.CompileSuccess.class, out);
        JsonNode elm = ((CqlCompilerService.CompileSuccess) out).elmJson();
        JsonNode defs = elm.path("library").path("statements").path("def");
        assertTrue(defs.isArray());
        java.util.Set<String> names = new java.util.HashSet<>();
        defs.forEach(d -> names.add(d.path("name").asText()));
        assertTrue(names.containsAll(java.util.List.of(
            "Diagnosis Documented", "Conservative Therapy Tried",
            "Imaging Documented", "Meets All Criteria")), () -> "defs: " + names);
        assertEquals("KneeArthroscopy", elm.path("library").path("identifier").path("id").asText());
    }

    @Test
    void returnsFailureForBadCql() {
        CqlCompilerService.CompileOutcome out = service.compile("library X\n@@@ not cql @@@");
        assertInstanceOf(CqlCompilerService.CompileFailure.class, out);
        assertFalse(((CqlCompilerService.CompileFailure) out).errors().isEmpty());
    }

    @Test
    void returnsFailureForUndefinedIdentifier() {
        String cql = "library X version '1.0.0'\ndefine \"D\": \"undefined_param\"";
        CqlCompilerService.CompileOutcome out = service.compile(cql);
        assertInstanceOf(CqlCompilerService.CompileFailure.class, out);
    }

    @Test
    void returnsFailureForBlankCql() {
        assertInstanceOf(CqlCompilerService.CompileFailure.class, service.compile("  "));
        assertInstanceOf(CqlCompilerService.CompileFailure.class, service.compile(null));
    }
}

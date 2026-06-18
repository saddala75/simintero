package io.simintero.digicore.runtime.engine;

import org.cqframework.cql.cql2elm.CqlTranslator;
import org.cqframework.cql.cql2elm.LibraryManager;
import org.cqframework.cql.cql2elm.ModelManager;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * De-risk spike for P1-b1: prove the HL7/CQF {@code cql-to-elm} translator compiles a trivial
 * parameterized CQL to ELM JSON inside this Spring Boot 3.2.5 / Java 21 module, and capture the
 * real ELM JSON node shapes that downstream code is written against.
 *
 * <p>Pinned: {@code info.cqframework:cql-to-elm:3.20.0} (jakarta-based 3.x line).
 */
class CqlToElmSpikeTest {

    private static final String CQL = """
        library Spike version '1.0.0'
        parameter "a" Boolean
        parameter "b" Boolean
        define "Both": "a" and "b"
        """;

    @Test
    void compilesTrivialParameterizedCqlToElmJson() {
        ModelManager modelManager = new ModelManager();
        LibraryManager libraryManager = new LibraryManager(modelManager);
        CqlTranslator translator = CqlTranslator.fromText(CQL, libraryManager);
        assertTrue(translator.getErrors().isEmpty(),
            () -> "unexpected compile errors: " + translator.getErrors());
        String elmJson = translator.toJson();
        assertTrue(elmJson.contains("\"Both\""), elmJson);
        assertTrue(elmJson.contains("And"), elmJson);
        System.out.println("=== SPIKE ELM JSON ===\n" + elmJson);
    }

    @Test
    void surfacesErrorsForBadCql() {
        ModelManager modelManager = new ModelManager();
        LibraryManager libraryManager = new LibraryManager(modelManager);
        CqlTranslator translator = CqlTranslator.fromText("library X\nthis is not cql", libraryManager);
        assertFalse(translator.getErrors().isEmpty());
    }
}

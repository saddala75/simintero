package io.simintero.digicore.runtime.engine;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CqlCompilerFhirTest {

    @Test
    void compilesFhirR4UsingCql() {
        String cql = """
            library FhirProof version '1.0.0'
            using FHIR version '4.0.1'
            context Patient
            define "Has Condition": exists [Condition]
            define "Meets All Criteria": "Has Condition"
            """;
        var out = new CqlCompilerService().compile(cql);
        assertInstanceOf(CqlCompilerService.CompileSuccess.class, out,
            () -> "FHIR CQL must compile; got " + out);
    }

    @Test
    void stillCompilesBooleanParameterCql() {
        String cql = """
            library Bool version '1.0.0'
            parameter "x" Boolean
            define "Meets All Criteria": "x"
            """;
        assertInstanceOf(CqlCompilerService.CompileSuccess.class, new CqlCompilerService().compile(cql));
    }
}

package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Condition;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CqfEvaluatorTest {

    private final CqfEvaluator evaluator = new CqfEvaluator(null, FhirContext.forR4());

    private static final String FHIR_RULE = """
        library Proof version '1.0.0'
        using FHIR version '4.0.1'
        context Patient
        define "Has Condition": exists [Condition]
        define "Meets All Criteria": "Has Condition"
        """;

    private RetrieveProviderStub conditions(boolean present) {
        return new RetrieveProviderStub(type ->
            (present && "Condition".equals(type)) ? List.of(new Condition()) : List.of());
    }

    @Test void meetsAllWhenConditionPresent() {
        var r = evaluator.evaluate(FHIR_RULE, "Proof", "1.0.0", Map.of(), "tenant-dev", "member-001", conditions(true));
        assertEquals("meets_all", r.outcome());
    }

    @Test void notMetWhenConditionAbsent() {
        var r = evaluator.evaluate(FHIR_RULE, "Proof", "1.0.0", Map.of(), "tenant-dev", "member-001", conditions(false));
        assertEquals("not_met", r.outcome());
    }

    @Test void abstainsWhenRetrieveThrows() {
        var boom = new RetrieveProviderStub(type -> { throw new RuntimeException("db down"); });
        var r = evaluator.evaluate(FHIR_RULE, "Proof", "1.0.0", Map.of(), "tenant-dev", "member-001", boom);
        assertEquals("indeterminate", r.outcome());
    }

    @Test void backwardCompatBooleanRule() {
        String cql = """
            library Bool version '1.0.0'
            parameter "diagnosis_documented" Boolean
            define "Meets All Criteria": "diagnosis_documented"
            """;
        assertEquals("meets_all",
            evaluator.evaluate(cql, "Bool", "1.0.0", Map.of("diagnosis_documented", true), "tenant-dev", "member-001", null).outcome());
        assertEquals("not_met",
            evaluator.evaluate(cql, "Bool", "1.0.0", Map.of("diagnosis_documented", false), "tenant-dev", "member-001", null).outcome());
    }

    @Test void abstainsWhenValueSetRuleHitsStubTerminology() {
        String vs = """
            library VS version '1.0.0'
            using FHIR version '4.0.1'
            valueset "VS": 'http://example.org/vs'
            context Patient
            define "Has": exists ([Condition: "VS"])
            define "Meets All Criteria": "Has"
            """;
        var r = evaluator.evaluate(vs, "VS", "1.0.0", Map.of(), "tenant-dev", "member-001", conditions(true));
        assertEquals("indeterminate", r.outcome()); // stub terminology throws -> abstain
    }
}

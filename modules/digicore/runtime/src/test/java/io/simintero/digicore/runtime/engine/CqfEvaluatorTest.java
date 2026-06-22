package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import org.hl7.fhir.r4.model.Condition;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    @Test void overloadParsesLibraryHeaderAndEvaluates() {
        var r = evaluator.evaluate(FHIR_RULE, Map.of(), "tenant-dev", "member-001", conditions(true));
        assertEquals("meets_all", r.outcome());
    }

    @Test void overloadAbstainsWhenNoLibraryHeader() {
        String headerless = "define \"Meets All Criteria\": true";
        var r = evaluator.evaluate(headerless, Map.of(), "tenant-dev", "member-001", conditions(true));
        assertEquals("indeterminate", r.outcome());
    }

    /**
     * I-1 fail-closed gate (direct, deterministic). A code-filtered retrieve can reach the gate with
     * a non-null {@code codePath} but an EMPTY {@code codes} list AND null {@code valueSet} — a
     * code/terminology filter slice 1.1 cannot honor. Producing exactly that arg-shape via CQL is not
     * reliable (the CQF engine resolves {@code Code from codesystem} through terminology, aborting
     * before retrieve, and a where-clause filter compiles to a type-only retrieve). So we exercise the
     * gate decision directly: it MUST probe the (throwing) terminology provider when codePath != null,
     * even with empty codes / null valueSet, so CqfEvaluator's backstop abstains.
     */
    @Test void gateFailsClosedOnCodePathWithEmptyCodesAndNullValueSet() {
        var delegate = new RetrieveProviderStub(type -> List.of(new Condition())); // would over-match if reached
        var gate = new CqfEvaluator.TerminologyGatedRetrieveProvider(delegate, new StubTerminologyProvider());
        // codePath != null, codes empty, valueSet null -> the gap. Gate must throw (stub terminology),
        // NOT delegate to the unfiltered stub.
        assertThrows(UnsupportedOperationException.class, () ->
            gate.retrieve("Patient", "subject", "member-001", "Condition", null,
                /* codePath */ "code", /* codes */ List.of(), /* valueSet */ null,
                null, null, null, null));
    }

    /** I-1 regression guard: a TRUE type-only retrieve (codePath==null, valueSet==null, empty codes)
     *  must still delegate normally (proving the gate change did not break {@code exists [Condition]}). */
    @Test void gateDelegatesTypeOnlyRetrieve() {
        var delegate = new RetrieveProviderStub(type -> List.of(new Condition()));
        var gate = new CqfEvaluator.TerminologyGatedRetrieveProvider(delegate, new StubTerminologyProvider());
        var out = gate.retrieve("Patient", "subject", "member-001", "Condition", null,
                /* codePath */ null, /* codes */ List.of(), /* valueSet */ null,
                null, null, null, null);
        assertTrue(out.iterator().hasNext()); // delegated, returned the stub's Condition
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

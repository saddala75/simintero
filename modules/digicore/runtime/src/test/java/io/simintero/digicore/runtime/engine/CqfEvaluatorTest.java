package io.simintero.digicore.runtime.engine;

import ca.uhn.fhir.context.FhirContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.fhir.r4.model.Condition;
import org.junit.jupiter.api.Test;
import org.opencds.cqf.cql.engine.retrieve.RetrieveProvider;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CqfEvaluatorTest {

    private final CqfEvaluator evaluator =
            new CqfEvaluator(null, FhirContext.forR4(), mock(VkasClient.class));

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

    // ------------------------------------------------------------------------
    // Slice 1.2: value-set membership filtering (real VkasTerminologyProvider).
    // Filtering lives in FabricRetrieveProvider, so drive it via a retrieveOverride
    // that is a real FabricRetrieveProvider subclass backed by a VkasTerminologyProvider.
    // ------------------------------------------------------------------------

    private static final String VS_URL = "http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.526.3.1498";
    private static final String VS_RULE = """
        library KneeVs version '1.0.0'
        using FHIR version '4.0.1'
        valueset "Knee Condition Codes": '%s'
        context Patient
        define "Has Knee Condition": exists ([Condition: "Knee Condition Codes"])
        define "Meets All Criteria": "Has Knee Condition"
        """.formatted(VS_URL);
    private static final String KNEE_VS_JSON = "{\"resourceType\":\"ValueSet\",\"expansion\":{\"contains\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"239873007\"}]}}";
    private static final String COND_MATCH = "{\"resourceType\":\"Condition\",\"id\":\"c1\",\"code\":{\"coding\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"239873007\"}]}}";
    private static final String COND_NONMATCH = "{\"resourceType\":\"Condition\",\"id\":\"c2\",\"code\":{\"coding\":[{\"system\":\"http://snomed.info/sct\",\"code\":\"99999999\"}]}}";

    /**
     * Build a FabricRetrieveProvider whose fetchContents returns the given Condition JSON list,
     * backed by a VkasTerminologyProvider over a mocked VkasClient returning the Knee VS for VS_URL.
     */
    private RetrieveProvider retrieveWith(java.util.List<String> condJson) throws Exception {
        VkasClient vkas = mock(VkasClient.class);
        when(vkas.resolveContent(any(), any(), any())).thenReturn(Optional.of(new ObjectMapper().readTree(KNEE_VS_JSON)));
        var term = new VkasTerminologyProvider(vkas);
        return new FabricRetrieveProvider(null, FhirContext.forR4(), "tenant-dev", "member-x", term) {
            @Override protected java.util.List<String> fetchContents(String t) { return condJson; }
        };
    }

    @Test void valueSetRuleMeetsAllWhenMemberHasMatchingCode() throws Exception {
        var ev = new CqfEvaluator(null, FhirContext.forR4(), mock(VkasClient.class));
        var r = ev.evaluate(VS_RULE, "KneeVs", "1.0.0", Map.of(), "tenant-dev", "member-x", retrieveWith(List.of(COND_MATCH)));
        assertEquals("meets_all", r.outcome());
    }

    @Test void valueSetRuleNotMetWhenOnlyNonMatchingCode() throws Exception { // ANTI-REGRESSION
        var ev = new CqfEvaluator(null, FhirContext.forR4(), mock(VkasClient.class));
        var r = ev.evaluate(VS_RULE, "KneeVs", "1.0.0", Map.of(), "tenant-dev", "member-x", retrieveWith(List.of(COND_NONMATCH)));
        assertEquals("not_met", r.outcome());
    }

    @Test void valueSetRuleAbstainsWhenValueSetUnresolvable() throws Exception {
        VkasClient vkas = mock(VkasClient.class);
        when(vkas.resolveContent(any(), any(), any())).thenReturn(Optional.empty()); // unresolvable
        var term = new VkasTerminologyProvider(vkas);
        var override = new FabricRetrieveProvider(null, FhirContext.forR4(), "tenant-dev", "member-x", term) {
            @Override protected java.util.List<String> fetchContents(String t) { return List.of(COND_MATCH); }
        };
        var ev = new CqfEvaluator(null, FhirContext.forR4(), mock(VkasClient.class));
        var r = ev.evaluate(VS_RULE, "KneeVs", "1.0.0", Map.of(), "tenant-dev", "member-x", override);
        assertEquals("indeterminate", r.outcome());
    }
}

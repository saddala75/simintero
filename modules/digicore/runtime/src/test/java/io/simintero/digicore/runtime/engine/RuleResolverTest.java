package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class RuleResolverTest {
    private final ObjectMapper m = new ObjectMapper();
    private JsonNode n(String j) { try { return m.readTree(j); } catch (Exception e) { throw new RuntimeException(e); } }

    private static final String COVERAGE_RULE_JSON = """
        {"procedure_codes":["27447"],"pa_required":true,
         "pins":["urn:sim:policy:knee-arthroscopy:1.0.0"],
         "dtr_package_ref":"urn:sim:dtr:knee-arthroscopy:1.0.0",
         "evidence_requirements":[{"requirement_id":"diagnosis_documented","required":true}],
         "elm_ref":"https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy","elm_version":"1.0.0"}
        """;

    private static final String KNEE_CQL = """
        library KneeArthroscopy version '1.0.0'
        parameter "diagnosis_documented" Boolean
        define "Meets All Criteria": "diagnosis_documented"
        """;

    @Test
    void resolveByProcedureParsesCoverageRule() {
        VkasClient vkas = stubReturning(COVERAGE_RULE_JSON);
        RuleResolver rr = new RuleResolver(vkas, new CqlCompilerService());
        Optional<CoverageRule> rule = rr.resolveByProcedure("27447", RuleContext.empty());
        assertTrue(rule.isPresent());
        assertTrue(rule.get().paRequired());
        assertEquals("https://artifacts.simintero.io/shared/cql_library/knee-arthroscopy", rule.get().elmRef());
        assertEquals(1, rule.get().evidenceRequirements().size());
        assertEquals(java.util.List.of("urn:sim:policy:knee-arthroscopy:1.0.0"), rule.get().pins());
    }

    @Test
    void resolveByProcedureEmptyWhenUnresolved() {
        RuleResolver rr = new RuleResolver(stubReturning(null), new CqlCompilerService());
        assertTrue(rr.resolveByProcedure("99999", RuleContext.empty()).isEmpty());
    }

    @Test
    void resolveElmCompilesCqlOnlyContentAndCaches() {
        AtomicInteger calls = new AtomicInteger();
        VkasClient vkas = new VkasClient() {
            public java.util.List<String> resolveDefaultPins(String s) { return java.util.List.of(); }
            public Optional<JsonNode> resolveContent(String url, String v, RuleContext c) {
                calls.incrementAndGet();
                com.fasterxml.jackson.databind.node.ObjectNode o = m.createObjectNode();
                o.put("cql", KNEE_CQL);
                return Optional.of(o);
            }
        };
        RuleResolver rr = new RuleResolver(vkas, new CqlCompilerService());
        var elm1 = rr.resolveElm("cql-url", "1.0.0", RuleContext.empty());
        var elm2 = rr.resolveElm("cql-url", "1.0.0", RuleContext.empty());
        assertTrue(elm1.isPresent(), "ELM should compile from cql-only content");
        assertEquals("Meets All Criteria",
            elm1.get().path("library").path("statements").path("def").get(0).path("name").asText());
        assertSame(elm1.get(), elm2.get());
        assertEquals(1, calls.get(), "second resolveElm must hit cache, not re-fetch");
    }

    @Test
    void resolveElmUsesPrecompiledElmWhenPresent() {
        // content already has compiled elm → no compile needed
        VkasClient vkas = new VkasClient() {
            public java.util.List<String> resolveDefaultPins(String s) { return java.util.List.of(); }
            public Optional<JsonNode> resolveContent(String url, String v, RuleContext c) {
                return Optional.of(n("{\"elm\":{\"library\":{\"statements\":{\"def\":[{\"name\":\"X\"}]}}}}"));
            }
        };
        RuleResolver rr = new RuleResolver(vkas, new CqlCompilerService());
        var elm = rr.resolveElm("u", "1.0.0", RuleContext.empty());
        assertTrue(elm.isPresent());
        assertEquals("X", elm.get().path("library").path("statements").path("def").get(0).path("name").asText());
    }

    private VkasClient stubReturning(String json) {
        return new VkasClient() {
            public java.util.List<String> resolveDefaultPins(String s) { return java.util.List.of(); }
            public Optional<JsonNode> resolveContent(String url, String v, RuleContext c) {
                return json == null ? Optional.empty() : Optional.of(n(json));
            }
        };
    }
}

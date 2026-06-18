package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class KneeFixtureCompileTest {

    @Test
    void committedElmMatchesCompiledCql() throws Exception {
        String cql = new String(
            getClass().getResourceAsStream("/cql/knee-arthroscopy.cql").readAllBytes(),
            StandardCharsets.UTF_8);
        CqlCompilerService.CompileOutcome out = new CqlCompilerService().compile(cql);
        assertInstanceOf(CqlCompilerService.CompileSuccess.class, out,
            () -> "compile failed: " + out);
        JsonNode compiled = ((CqlCompilerService.CompileSuccess) out).elmJson();

        ObjectMapper m = new ObjectMapper();
        JsonNode committed = m.readTree(getClass().getResourceAsStream("/elm/knee-arthroscopy.elm.json"));

        // Compare the meaningful subtree, tolerant of translator annotation/locator noise:
        // identifier + the set of def names must match.
        assertEquals(committed.path("library").path("identifier").path("id").asText(),
                     compiled.path("library").path("identifier").path("id").asText());
        assertEquals(defNames(committed), defNames(compiled),
            "committed ELM def names drifted from knee-arthroscopy.cql");
    }

    private static java.util.Set<String> defNames(JsonNode elm) {
        java.util.Set<String> s = new java.util.TreeSet<>();
        elm.path("library").path("statements").path("def").forEach(d -> s.add(d.path("name").asText()));
        return s;
    }
}

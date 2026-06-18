package io.simintero.digicore.runtime.engine;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;

class RuleLibraryCompileTest {
    private String cql(String name) throws Exception {
        return new String(getClass().getResourceAsStream("/cql/" + name).readAllBytes(), StandardCharsets.UTF_8);
    }
    private void assertCompiles(String file) throws Exception {
        var out = new CqlCompilerService().compile(cql(file));
        assertInstanceOf(CqlCompilerService.CompileSuccess.class, out, () -> file + " failed to compile: " + out);
        var defs = ((CqlCompilerService.CompileSuccess) out).elmJson()
            .path("library").path("statements").path("def");
        boolean hasMeetsAll = false;
        for (var d : defs) if ("Meets All Criteria".equals(d.path("name").asText())) hasMeetsAll = true;
        assertTrue(hasMeetsAll, file + " missing 'Meets All Criteria' define");
    }
    @Test void kneeCompiles() throws Exception { assertCompiles("knee-arthroscopy.cql"); }
    @Test void lumbarCompiles() throws Exception { assertCompiles("lumbar-spine-mri.cql"); }
    @Test void endoscopyCompiles() throws Exception { assertCompiles("upper-endoscopy.cql"); }
    @Test void ctCompiles() throws Exception { assertCompiles("ct-abdomen-pelvis.cql"); }
}

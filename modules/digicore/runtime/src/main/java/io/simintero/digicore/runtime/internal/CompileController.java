package io.simintero.digicore.runtime.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.Map;

/**
 * Internal operation: POST /internal/compile
 *
 * Phase 1 stub: accepts { "cql": "..." } and returns the bundled knee-arthroscopy
 * ELM JSON regardless of the CQL content. Phase 2 will wire this to a real CQL
 * compiler (consumed by the authoring service).
 *
 * Returns 400 with { "errors": ["CQL compilation error"] } when CQL is blank/null.
 */
@RestController
@RequestMapping("/internal")
public class CompileController {

    private final ObjectMapper mapper = new ObjectMapper();

    @PostMapping("/compile")
    public ResponseEntity<?> compile(@RequestBody Map<String, Object> request) {
        Object cqlValue = request.get("cql");
        if (cqlValue == null || cqlValue.toString().isBlank()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("errors", new String[]{"CQL compilation error"}));
        }

        try (InputStream is = getClass().getResourceAsStream("/elm/knee-arthroscopy.elm.json")) {
            if (is == null) {
                return ResponseEntity.internalServerError()
                        .body(Map.of("errors", new String[]{"ELM fixture not found"}));
            }
            JsonNode elm = mapper.readTree(is);
            return ResponseEntity.ok(elm);
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("errors", new String[]{e.getMessage()}));
        }
    }
}

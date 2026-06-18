package io.simintero.digicore.runtime.internal;

import io.simintero.digicore.runtime.engine.CqlCompilerService;
import io.simintero.digicore.runtime.engine.CqlCompilerService.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** POST /internal/compile — real CQL→ELM compile (consumed by the authoring service). */
@RestController
@RequestMapping("/internal")
public class CompileController {

    private final CqlCompilerService compiler;

    public CompileController(CqlCompilerService compiler) {
        this.compiler = compiler;
    }

    @PostMapping("/compile")
    public ResponseEntity<?> compile(@RequestBody Map<String, Object> request) {
        Object cql = request.get("cql");
        CompileOutcome outcome = compiler.compile(cql == null ? null : cql.toString());
        if (outcome instanceof CompileSuccess s) {
            return ResponseEntity.ok(s.elmJson());
        }
        return ResponseEntity.badRequest()
                .body(Map.of("errors", ((CompileFailure) outcome).errors()));
    }
}

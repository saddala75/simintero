package io.simintero.fhir.crd;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * CDS Hooks discovery and hook-invocation controller.
 *
 * Discovery: GET /cds-services → 501 (stub; not implemented until Phase 1B)
 * Hook invoke: POST /cds-services/{hookId} → 501 (not wired to real logic until Phase 1B)
 *
 * PHI CONTRACT: No request body content is logged.
 */
@RestController
@RequestMapping("/cds-services")
public class CrdHooksController {

    private final CrdMapper crdMapper;

    public CrdHooksController(CrdMapper crdMapper) {
        this.crdMapper = crdMapper;
    }

    /**
     * CDS Hooks discovery endpoint.
     * Returns HTTP 501 — discovery is not implemented in Phase 1.
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> discovery() {
        return ResponseEntity
                .status(HttpStatus.NOT_IMPLEMENTED)
                .body(Map.of("note", "CDS Hooks discovery not implemented in Phase 1"));
    }

    /**
     * CDS Hooks invocation endpoint.
     * Returns HTTP 501 for all hooks until Phase 1B wires the real CRD logic.
     */
    @PostMapping("/{hookId}")
    public ResponseEntity<Map<String, Object>> invokeHook(
            @PathVariable String hookId,
            @RequestBody Map<String, Object> hookRequest) {

        // Phase 1 stub — CrdMapper.map() returns null; real logic is Phase 1B
        return ResponseEntity
                .status(HttpStatus.NOT_IMPLEMENTED)
                .body(Map.of(
                        "cards", List.of(),
                        "note", "CRD hook '" + hookId + "' not implemented in Phase 1"
                ));
    }
}

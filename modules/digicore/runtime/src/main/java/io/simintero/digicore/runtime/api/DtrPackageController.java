package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.VkasClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;

/**
 * C-1 operations:
 *   GET  /v1/runtime/dtr-packages/{ref}  — fetch a DTR questionnaire package by VKAS canonical_url ref
 *   POST /v1/runtime/dtr-packages        — resolve a DTR package by ref from the request body
 *
 * Both endpoints resolve via VKAS. Returns 404 when the ref is not found; VKAS outage degrades
 * gracefully to 404 (HttpVkasClient returns Optional.empty() on exception).
 */
@RestController
@RequestMapping("/v1/runtime/dtr-packages")
public class DtrPackageController {

    private final VkasClient vkasClient;

    @Autowired
    public DtrPackageController(VkasClient vkasClient) {
        this.vkasClient = vkasClient;
    }

    @GetMapping("/{ref}")
    public ResponseEntity<?> getPackage(@PathVariable String ref) {
        Optional<JsonNode> content = vkasClient.resolveContent(ref, null, RuleContext.empty());
        return content
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElse(ResponseEntity.status(404).body(Map.of("error", "No DTR package for ref: " + ref)));
    }

    @PostMapping
    public ResponseEntity<?> resolvePackage(@RequestBody Map<String, Object> request) {
        Object refObj = request.get("dtr_package_ref");
        if (refObj == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "dtr_package_ref is required"));
        }
        String ref = refObj.toString();
        Optional<JsonNode> content = vkasClient.resolveContent(ref, null, RuleContext.empty());
        return content
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElse(ResponseEntity.status(404).body(Map.of("error", "No DTR package for ref: " + ref)));
    }
}

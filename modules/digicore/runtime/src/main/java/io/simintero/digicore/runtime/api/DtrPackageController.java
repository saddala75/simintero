package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.Map;

/**
 * C-1 operations:
 *   GET  /v1/runtime/dtr-packages/{ref}  — fetch a DTR questionnaire package by ref
 *   POST /v1/runtime/dtr-packages        — create / look up a DTR package (Phase 1: echo back knee package)
 *
 * Returns the DTR questionnaire package.
 */
@RestController
@RequestMapping("/v1/runtime/dtr-packages")
public class DtrPackageController {

    private final ObjectMapper mapper = new ObjectMapper();

    @GetMapping("/{ref}")
    public ResponseEntity<?> getPackage(@PathVariable String ref) {
        return loadDtrPackage();
    }

    @PostMapping
    public ResponseEntity<?> resolvePackage(@RequestBody Map<String, Object> request) {
        return loadDtrPackage();
    }

    private ResponseEntity<?> loadDtrPackage() {
        try (InputStream is = getClass().getResourceAsStream("/dtr/knee-arthroscopy-dtr.json")) {
            if (is == null) {
                return ResponseEntity.notFound().build();
            }
            JsonNode node = mapper.readTree(is);
            return ResponseEntity.ok(node);
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Failed to load DTR package: " + e.getMessage()));
        }
    }
}

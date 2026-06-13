package io.simintero.digicore.runtime.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * C-1 operation: POST /v1/runtime/coverage-discovery
 *
 * Returns {pa_required, governing_rules[], pins[], dtr_package_ref}.
 * Phase 1 stub: matches on service_code containing "knee" or procedure code "27447".
 */
@RestController
@RequestMapping("/v1/runtime")
public class CoverageDiscoveryController {

    private static final String KNEE_PIN = "urn:sim:policy:knee-arthroscopy:1.0.0";
    private static final String KNEE_DTR = "urn:sim:dtr:knee-arthroscopy:1.0.0";

    @PostMapping("/coverage-discovery")
    public ResponseEntity<Map<String, Object>> discover(@RequestBody Map<String, Object> request) {
        String serviceCode = getString(request, "service_code");
        String procedureCode = getString(request, "procedure_code");

        boolean isKnee = (serviceCode != null && serviceCode.toLowerCase().contains("knee"))
                || "27447".equals(procedureCode);

        if (isKnee) {
            Map<String, Object> response = Map.of(
                    "pa_required", true,
                    "governing_rules", List.of(
                            Map.of("rule_id", "knee-arthroscopy-criteria", "version", "1.0.0")
                    ),
                    "pins", List.of(KNEE_PIN),
                    "dtr_package_ref", KNEE_DTR
            );
            return ResponseEntity.ok(response);
        }

        Map<String, Object> response = new java.util.LinkedHashMap<>();
        response.put("pa_required", false);
        response.put("governing_rules", List.of());
        response.put("pins", List.of());
        response.put("dtr_package_ref", null);
        return ResponseEntity.ok(response);
    }

    private String getString(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}

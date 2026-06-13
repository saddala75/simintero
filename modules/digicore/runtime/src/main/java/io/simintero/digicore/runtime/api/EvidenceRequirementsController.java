package io.simintero.digicore.runtime.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * C-1 operation: POST /v1/runtime/evidence-requirements:resolve
 *
 * Returns the set of evidence requirements for a given case type / service code.
 * Phase 1 stub: returns the three requirements for knee_arthroscopy.
 */
@RestController
@RequestMapping("/v1/runtime")
public class EvidenceRequirementsController {

    @PostMapping("/evidence-requirements:resolve")
    public ResponseEntity<Map<String, Object>> resolve(@RequestBody Map<String, Object> request) {
        String serviceCode = getString(request, "service_code");

        if (serviceCode != null && serviceCode.toLowerCase().contains("knee")) {
            Map<String, Object> response = Map.of(
                    "service_code", serviceCode,
                    "requirements", List.of(
                            Map.of(
                                    "requirement_id", "diagnosis_documented",
                                    "display", "Diagnosis of knee condition documented",
                                    "required", true
                            ),
                            Map.of(
                                    "requirement_id", "conservative_therapy_tried",
                                    "display", "Conservative therapy attempted and documented",
                                    "required", true
                            ),
                            Map.of(
                                    "requirement_id", "imaging_documented",
                                    "display", "Imaging (X-ray or MRI) documented",
                                    "required", true
                            )
                    )
            );
            return ResponseEntity.ok(response);
        }

        return ResponseEntity.ok(Map.of(
                "service_code", serviceCode == null ? "" : serviceCode,
                "requirements", List.of()
        ));
    }

    private String getString(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}

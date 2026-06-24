package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * C-1 operation: POST /v1/runtime/evidence-requirements:resolve
 *
 * Returns the set of evidence requirements for a given service code, resolved
 * data-driven from the matching coverage_rule artifact via {@link RuleResolver}.
 */
@RestController
@RequestMapping("/v1/runtime")
public class EvidenceRequirementsController {

    private final RuleResolver ruleResolver;

    public EvidenceRequirementsController(RuleResolver ruleResolver) {
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/evidence-requirements:resolve")
    public ResponseEntity<Map<String, Object>> resolve(@RequestBody Map<String, Object> request) {
        String serviceCode = getString(request, "service_code");
        if (serviceCode == null) {
            serviceCode = getString(request, "procedure_code");
        }

        Optional<CoverageRule> rule = ruleResolver.resolveByProcedure(serviceCode, RuleContext.empty());
        List<Map<String, Object>> requirements =
                rule.map(CoverageRule::evidenceRequirements).orElse(List.of());

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("service_code", serviceCode == null ? "" : serviceCode);
        response.put("requirements", requirements);
        response.put("pins", rule.map(CoverageRule::pins).orElse(java.util.List.of()));
        return ResponseEntity.ok(response);
    }

    private String getString(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}

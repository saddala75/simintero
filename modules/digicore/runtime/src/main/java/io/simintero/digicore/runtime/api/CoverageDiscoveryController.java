package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * C-1 operation: POST /v1/runtime/coverage-discovery
 *
 * Returns {pa_required, governing_rules[], pins[], dtr_package_ref}.
 * Resolves the governing coverage_rule from VKAS (via RuleResolver) keyed by
 * procedure_code (falling back to service_code). No hardcoded policy logic.
 */
@RestController
@RequestMapping("/v1/runtime")
public class CoverageDiscoveryController {

    private final RuleResolver ruleResolver;

    public CoverageDiscoveryController(RuleResolver ruleResolver) {
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/coverage-discovery")
    public ResponseEntity<Map<String, Object>> discover(@RequestBody Map<String, Object> request) {
        String serviceCode = getString(request, "service_code");
        String procedureCode = getString(request, "procedure_code");

        String code = (procedureCode != null && !procedureCode.isBlank()) ? procedureCode : serviceCode;
        Optional<CoverageRule> rule = ruleResolver.resolveByProcedure(code, RuleContext.empty());

        Map<String, Object> resp = new java.util.LinkedHashMap<>();
        if (rule.isPresent() && rule.get().paRequired()) {
            CoverageRule r = rule.get();
            resp.put("pa_required", true);
            resp.put("governing_rules", List.of(Map.of(
                    "rule_id", "coverage_rule/" + code,
                    "version", r.elmVersion() == null ? "1.0.0" : r.elmVersion())));
            resp.put("pins", r.pins());
            resp.put("dtr_package_ref", r.dtrPackageRef());   // may be null -> LinkedHashMap allows it
        } else {
            resp.put("pa_required", false);
            resp.put("governing_rules", List.of());
            resp.put("pins", List.of());
            resp.put("dtr_package_ref", null);
        }
        return ResponseEntity.ok(resp);
    }

    private String getString(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}

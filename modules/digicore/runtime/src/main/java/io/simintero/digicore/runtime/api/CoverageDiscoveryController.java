package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * C-1 operation: POST /v1/runtime/coverage-discovery
 *
 * Returns {pa_required, governing_rules[], pins[], dtr_package_ref}.
 * Resolves the governing coverage_rule from VKAS (via RuleResolver) keyed by
 * procedure_code (falling back to service_code). No hardcoded policy logic.
 *
 * Phase 3.4: If multiple codes in procedure_codes each independently require PA,
 * returns 409 SIM-DIG-CONFLICT — the engine cannot auto-resolve the ambiguity.
 */
@RestController
@RequestMapping("/v1/runtime")
public class CoverageDiscoveryController {

    private final RuleResolver ruleResolver;

    public CoverageDiscoveryController(RuleResolver ruleResolver) {
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/coverage-discovery")
    public ResponseEntity<?> discover(@RequestBody Map<String, Object> request) {
        String serviceCode = getString(request, "service_code");
        String procedureCode = getString(request, "procedure_code");

        @SuppressWarnings("unchecked")
        List<String> codes;
        Object raw = request.get("procedure_codes");
        if (raw instanceof List<?> list && !list.isEmpty()) {
            codes = list.stream().map(Object::toString).toList();
        } else {
            String code = (procedureCode != null && !procedureCode.isBlank()) ? procedureCode : serviceCode;
            codes = code != null ? List.of(code) : List.of();
        }

        // Resolve rules for all codes and collect those that require PA
        List<String> conflictingCodes = new ArrayList<>();
        Optional<CoverageRule> paRule = Optional.empty();
        String paCode = null;

        for (String code : codes) {
            Optional<CoverageRule> rule = ruleResolver.resolveByProcedure(code, RuleContext.empty());
            if (rule.isPresent() && rule.get().paRequired()) {
                conflictingCodes.add(code);
                paRule = rule;
                paCode = code;
            }
        }

        // Conflict: more than one code independently requires PA
        if (conflictingCodes.size() > 1) {
            Map<String, Object> conflict = new java.util.LinkedHashMap<>();
            conflict.put("error", "SIM-DIG-CONFLICT");
            conflict.put("message", "Multiple procedure codes require prior authorization and cannot be auto-resolved");
            conflict.put("conflicting_codes", conflictingCodes);
            return ResponseEntity.status(409).body(conflict);
        }

        Map<String, Object> resp = new java.util.LinkedHashMap<>();
        if (paRule.isPresent()) {
            CoverageRule r = paRule.get();
            resp.put("pa_required", true);
            resp.put("governing_rules", List.of(Map.of(
                    "rule_id", "coverage_rule/" + paCode,
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

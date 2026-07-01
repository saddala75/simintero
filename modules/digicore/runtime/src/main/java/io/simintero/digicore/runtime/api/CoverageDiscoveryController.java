package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

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

        List<String> codes;
        Object raw = request.get("procedure_codes");
        if (raw instanceof List<?> list && !list.isEmpty()) {
            codes = list.stream().map(Object::toString).toList();
        } else {
            String code = (procedureCode != null && !procedureCode.isBlank()) ? procedureCode : serviceCode;
            codes = code != null ? List.of(code) : List.of();
        }

        // Single pass: collect PA rules and the first non-PA resolved rule
        List<String> conflictingCodes = new ArrayList<>();
        Optional<CoverageRule> paRule = Optional.empty();
        String paCode = null;
        Optional<CoverageRule> nonPaRule = Optional.empty();
        String nonPaCode = null;

        for (String code : codes) {
            Optional<CoverageRule> rule = ruleResolver.resolveByProcedure(code, RuleContext.empty());
            if (rule.isPresent()) {
                if (rule.get().paRequired()) {
                    conflictingCodes.add(code);
                    paRule = rule;
                    paCode = code;
                } else if (nonPaRule.isEmpty()) {
                    nonPaRule = rule;
                    nonPaCode = code;
                }
            }
        }

        // Conflict: multiple codes independently require PA
        if (conflictingCodes.size() > 1) {
            Map<String, Object> conflict = new LinkedHashMap<>();
            conflict.put("error", "SIM-DIG-CONFLICT");
            conflict.put("message", "Multiple procedure codes require prior authorization and cannot be auto-resolved");
            conflict.put("conflicting_codes", conflictingCodes);
            return ResponseEntity.status(409).body(conflict);
        }

        if (paRule.isPresent()) {
            return ResponseEntity.ok(buildResponse(paRule.get(), paCode, true));
        } else if (nonPaRule.isPresent()) {
            return ResponseEntity.ok(buildResponse(nonPaRule.get(), nonPaCode, false));
        } else {
            Map<String, Object> resp = new LinkedHashMap<>();
            resp.put("pa_required", false);
            resp.put("governing_rules", List.of());
            resp.put("pins", List.of());
            resp.put("dtr_package_ref", null);
            return ResponseEntity.ok(resp);
        }
    }

    private Map<String, Object> buildResponse(CoverageRule r, String code, boolean paRequired) {
        List<Map<String, Object>> governingRules = new ArrayList<>();

        // Primary rule entry
        Map<String, Object> primary = new LinkedHashMap<>();
        String ruleId = "ncd".equals(r.sourceType())
            ? RuleResolver.NCD_PROCEDURE_BASE + code
            : "coverage_rule/" + code;
        primary.put("rule_id", ruleId);
        primary.put("version", r.elmVersion() == null ? "1.0.0" : r.elmVersion());
        if (r.sourceType() != null) primary.put("source_type", r.sourceType());
        governingRules.add(primary);

        // NCD provenance from payer supplement relations
        if (r.relations() != null) {
            for (Map<String, Object> rel : r.relations()) {
                if ("ncd".equals(rel.get("source_type"))) {
                    Map<String, Object> ncdEntry = new LinkedHashMap<>();
                    ncdEntry.put("rule_id", rel.get("target"));
                    ncdEntry.put("source_type", "ncd");
                    governingRules.add(ncdEntry);
                }
            }
        }

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("pa_required", paRequired);
        resp.put("governing_rules", governingRules);
        resp.put("pins", r.pins() != null ? r.pins() : List.of());
        resp.put("dtr_package_ref", r.dtrPackageRef());
        if (r.coverageIndicator() != null) resp.put("coverage_indicator", r.coverageIndicator());
        return resp;
    }

    private String getString(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : v.toString();
    }
}

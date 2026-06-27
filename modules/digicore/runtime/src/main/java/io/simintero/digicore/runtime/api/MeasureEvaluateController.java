package io.simintero.digicore.runtime.api;

import io.simintero.digicore.runtime.engine.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/v1/runtime")
public class MeasureEvaluateController {

    private static final Logger log = LoggerFactory.getLogger(MeasureEvaluateController.class);
    private static final Set<String> POPULATION_EXPRESSIONS =
        Set.of("Denominator", "Numerator", "Exclusion", "Exception");

    private final CqfEvaluator cqfEvaluator;
    private final RuleResolver ruleResolver;

    public MeasureEvaluateController(CqfEvaluator cqfEvaluator, RuleResolver ruleResolver) {
        this.cqfEvaluator = cqfEvaluator;
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/measure-evaluate")
    public ResponseEntity<MeasureEvaluateResponse> measureEvaluate(
            @RequestBody MeasureEvaluateRequest request) {

        if (request.memberRefs() == null || request.memberRefs().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        Optional<String> cqlOpt = ruleResolver.resolveCql(
            request.libraryRef(), null, RuleContext.empty());
        if (cqlOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        String cqlText = cqlOpt.get();

        List<MemberEvaluationResult> results = new ArrayList<>();
        for (String memberRef : request.memberRefs()) {
            ElmEvaluator.ElmResult elm = cqfEvaluator.evaluate(
                cqlText, Map.of(), request.tenantId(), memberRef, null);

            if ("indeterminate".equals(elm.outcome())) {
                log.warn("CQL evaluation indeterminate for member {} in library {}",
                    memberRef, request.libraryRef());
            }

            // Extract population booleans from logicPath.
            // Each entry: {step: expressionName, result: "true"/"false"}
            Map<String, Boolean> pop = new HashMap<>();
            for (Map<String, Object> step : elm.logicPath()) {
                String name = String.valueOf(step.get("step"));
                if (POPULATION_EXPRESSIONS.contains(name)) {
                    pop.put(name, "true".equals(String.valueOf(step.get("result"))));
                }
            }

            results.add(new MemberEvaluationResult(
                memberRef,
                pop.getOrDefault("Denominator", false),
                pop.getOrDefault("Numerator",   false),
                pop.getOrDefault("Exclusion",   false),
                pop.getOrDefault("Exception",   false),
                "qual-trace:" + UUID.randomUUID()
            ));
        }

        return ResponseEntity.ok(new MeasureEvaluateResponse(results));
    }
}

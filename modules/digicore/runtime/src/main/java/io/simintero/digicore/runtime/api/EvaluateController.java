package io.simintero.digicore.runtime.api;

import com.fasterxml.jackson.databind.JsonNode;
import io.simintero.digicore.runtime.engine.CoverageRule;
import io.simintero.digicore.runtime.engine.ElmEvaluator;
import io.simintero.digicore.runtime.engine.PinResolver;
import io.simintero.digicore.runtime.engine.RuleContext;
import io.simintero.digicore.runtime.engine.RuleResolver;
import io.simintero.digicore.runtime.model.EvaluationRequest;
import io.simintero.digicore.runtime.model.EvaluationResponse;
import io.simintero.digicore.runtime.trace.TraceBuilder;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * C-1 operation: POST /v1/runtime/evaluate
 *
 * Determinism rule enforced by the engine:
 *   identical (request body + pins) → byte-identical outcome, requirementGaps, logicPath.
 *   auto_determination.eligible is set to true ONLY for meets_all.
 */
@RestController
@RequestMapping("/v1/runtime")
public class EvaluateController {

    private final ElmEvaluator evaluator;
    private final PinResolver pinResolver;
    private final TraceBuilder traceBuilder;
    private final RuleResolver ruleResolver;

    public EvaluateController(ElmEvaluator evaluator, PinResolver pinResolver,
                              TraceBuilder traceBuilder, RuleResolver ruleResolver) {
        this.evaluator = evaluator;
        this.pinResolver = pinResolver;
        this.traceBuilder = traceBuilder;
        this.ruleResolver = ruleResolver;
    }

    @PostMapping("/evaluate")
    public ResponseEntity<EvaluationResponse> evaluate(@RequestBody EvaluationRequest request) {
        // 1. Resolve pins — NEVER calls VKAS when caller supplies pins
        List<String> resolvedPins = pinResolver.resolve(request.pins(), request.serviceCode());

        // 2. Resolve the governing coverage rule by service code, then its ELM, and evaluate
        //    THAT library. If the rule or its ELM cannot be resolved we abstain
        //    (indeterminate) — NEVER fall back to the default knee fixture, NEVER silently approve.
        RuleContext ctx = RuleContext.empty();
        Optional<CoverageRule> rule = ruleResolver.resolveByProcedure(request.serviceCode(), ctx);
        Optional<JsonNode> elm = rule.flatMap(r -> ruleResolver.resolveElm(r.elmRef(), r.elmVersion(), ctx));
        ElmEvaluator.ElmResult result;
        if (elm.isPresent()) {
            result = evaluator.evaluate(request.evidence(), elm.get());
            if (rule.isPresent() && !rule.get().pins().isEmpty()) {
                resolvedPins = rule.get().pins();
            }
        } else {
            result = new ElmEvaluator.ElmResult("indeterminate", List.of(), List.of());
        }

        // 3. Build auto_determination — eligible ONLY for meets_all (safety invariant)
        boolean eligible = "meets_all".equals(result.outcome());
        Map<String, Object> autoDetermination = Map.of("eligible", eligible);

        // 4. Build trace
        String traceRef = traceBuilder.newTraceRef();
        List<Map<String, Object>> logicPath = traceBuilder.buildLogicPath(result.logicPath());

        EvaluationResponse response = new EvaluationResponse(
                result.outcome(),
                result.requirementGaps(),
                logicPath,
                autoDetermination,
                resolvedPins,
                traceRef
        );

        return ResponseEntity.ok(response);
    }
}

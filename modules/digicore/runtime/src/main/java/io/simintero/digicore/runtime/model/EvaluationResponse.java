package io.simintero.digicore.runtime.model;

import java.util.List;
import java.util.Map;

public record EvaluationResponse(
        String outcome,
        List<Map<String, Object>> requirementGaps,
        List<Map<String, Object>> logicPath,
        Map<String, Object> autoDetermination,
        List<String> pins,
        String traceRef
) {}

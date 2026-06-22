package io.simintero.digicore.runtime.model;

import java.util.List;
import java.util.Map;

public record EvaluationRequest(
        String caseId,
        Map<String, Object> evidence,
        List<String> pins,
        String serviceCode,
        String memberRef,
        String tenantId
) {}

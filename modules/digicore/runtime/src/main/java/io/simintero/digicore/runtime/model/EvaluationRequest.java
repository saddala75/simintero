package io.simintero.digicore.runtime.model;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.util.List;
import java.util.Map;

public record EvaluationRequest(
        @JsonAlias("caseId") String caseId,
        Map<String, Object> evidence,
        List<String> pins,
        @JsonAlias("serviceCode") String serviceCode,
        String memberRef,
        String tenantId
) {}

package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Response from digicore-runtime C-1 {@code POST /v1/runtime/evidence-requirements:resolve}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EvidenceRequirementsResponse(
        @JsonProperty("service_code") String serviceCode,
        List<Requirement> requirements) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Requirement(
            @JsonProperty("requirement_id") String requirementId,
            String display,
            boolean required) {}
}

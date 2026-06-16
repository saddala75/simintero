package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Response from digicore-runtime C-1 {@code POST /v1/runtime/coverage-discovery}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CoverageDiscoveryResponse(
        @JsonProperty("pa_required") boolean paRequired,
        @JsonProperty("governing_rules") List<GoverningRule> governingRules,
        List<String> pins,
        @JsonProperty("dtr_package_ref") String dtrPackageRef) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record GoverningRule(
            @JsonProperty("rule_id") String ruleId,
            String version) {}
}

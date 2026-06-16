package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Coverage-requirements content assembled in-process from the digicore-runtime C-1
 * {@code coverage-discovery} + {@code evidence-requirements:resolve} responses.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CrdContent(
        @JsonProperty("pa_required") boolean paRequired,
        @JsonProperty("documentation_requirements") List<String> documentationRequirements,
        @JsonProperty("rule_reference") String ruleReference,
        @JsonProperty("dtr_launch_url") String dtrLaunchUrl) {}

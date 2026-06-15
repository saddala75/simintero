package com.simintero.enstellar.interop.crd;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/** Coverage-requirements content returned by Digicore ({@code GET /api/v1/crd}). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CrdContent(
        @JsonProperty("pa_required") boolean paRequired,
        @JsonProperty("documentation_requirements") List<String> documentationRequirements,
        @JsonProperty("rule_reference") String ruleReference,
        @JsonProperty("dtr_launch_url") String dtrLaunchUrl) {}

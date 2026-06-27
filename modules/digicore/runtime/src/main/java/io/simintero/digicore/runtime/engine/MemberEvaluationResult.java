package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MemberEvaluationResult(
    @JsonProperty("memberRef")    String memberRef,
    @JsonProperty("denominator")  boolean denominator,
    @JsonProperty("numerator")    boolean numerator,
    @JsonProperty("exclusion")    boolean exclusion,
    @JsonProperty("exception")    boolean exception,
    @JsonProperty("traceRef")     String traceRef
) {}

package io.simintero.digicore.runtime.engine;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record MeasureEvaluateRequest(
    @JsonProperty("tenantId")    String tenantId,
    @JsonProperty("libraryRef")  String libraryRef,
    @JsonProperty("memberRefs")  List<String> memberRefs,
    @JsonProperty("periodStart") String periodStart,
    @JsonProperty("periodEnd")   String periodEnd
) {}

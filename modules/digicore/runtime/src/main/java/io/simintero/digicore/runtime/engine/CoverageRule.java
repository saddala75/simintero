package io.simintero.digicore.runtime.engine;

import java.util.List;
import java.util.Map;

public record CoverageRule(
    List<String> procedureCodes,
    boolean paRequired,
    List<String> pins,
    String dtrPackageRef,
    List<Map<String, Object>> evidenceRequirements,
    String elmRef,
    String elmVersion,
    @com.fasterxml.jackson.annotation.JsonProperty("source_type") String sourceType,
    @com.fasterxml.jackson.annotation.JsonProperty("coverage_indicator") String coverageIndicator,
    List<Map<String, Object>> relations
) {}

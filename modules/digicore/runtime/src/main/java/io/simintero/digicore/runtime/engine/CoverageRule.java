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
    String elmVersion
) {}

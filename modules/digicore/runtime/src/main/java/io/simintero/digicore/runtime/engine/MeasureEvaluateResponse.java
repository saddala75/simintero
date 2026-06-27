package io.simintero.digicore.runtime.engine;

import java.util.List;

public record MeasureEvaluateResponse(
    List<MemberEvaluationResult> results
) {}

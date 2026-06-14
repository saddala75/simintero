"""GuardrailEngine — runs all 7 rules and returns a GuardrailResult.

Import pattern:
    from enstellar_agents.guardrails import GuardrailEngine
"""
from __future__ import annotations

from enstellar_agents.guardrails.rules import (
    rule_abstention_on_low_confidence,
    rule_citations_required,
    rule_confidence_threshold,
    rule_no_autonomous_adverse,
    rule_phi_minimization,
    rule_schema_validity,
    rule_tenant_isolation,
)
from enstellar_agents.models import AgentOutput, GuardrailResult


class GuardrailEngine:
    """Stateless engine that evaluates all guardrail rules against an AgentOutput.

    Usage::
        result = GuardrailEngine().check(output, expected_tenant_id="tenant-abc")
        if not result.passed:
            # output must not be returned to the caller
    """

    def check(self, output: AgentOutput, expected_tenant_id: str) -> GuardrailResult:
        """Run all 7 rules; return GuardrailResult with passed=False if any rule fires."""
        violations = [
            v
            for v in [
                rule_no_autonomous_adverse(output),
                rule_citations_required(output),
                rule_confidence_threshold(output),
                rule_schema_validity(output),
                rule_tenant_isolation(output, expected_tenant_id),
                rule_phi_minimization(output),
                rule_abstention_on_low_confidence(output),
            ]
            if v is not None
        ]
        return GuardrailResult(passed=len(violations) == 0, violations=violations)

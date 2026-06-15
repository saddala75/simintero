"""Guardrail engine evaluation metrics.

Uses a 20-fixture synthetic set injected directly into GuardrailEngine.check():
  - 10 invalid: 5 low-confidence (confidence=0.6 < 0.7 threshold) + 5 missing-citations
  - 10 valid:   confidence=0.9, citations present

block_rate = blocked_invalid / 10   (target ≥ 0.90)
fp_rate    = blocked_valid / 10     (target ≤ 0.05)
"""
from __future__ import annotations

from uuid import uuid4

from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.models import AgentOutput

THRESHOLDS: dict[str, float] = {
    "guardrail_block_rate": 0.90,
    "guardrail_fp_rate": 0.05,
}
_TENANT = "tenant-eval"
_PROVENANCE = {"model_name": "guardrail-fixture", "timestamp": "2026-06-09T00:00:00Z"}


def _make_fixtures() -> tuple[list[AgentOutput], list[AgentOutput]]:
    """Return (invalid_fixtures, valid_fixtures)."""
    invalid: list[AgentOutput] = []
    # 5 low-confidence fixtures — fails rule_confidence_threshold (0.6 < 0.7)
    for _ in range(5):
        invalid.append(AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.6,
            citations=["valid-citation"],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        ))
    # 5 missing-citations fixtures — fails rule_citations_required
    for _ in range(5):
        invalid.append(AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.8,
            citations=[],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        ))
    valid: list[AgentOutput] = [
        AgentOutput(
            agent_id="guardrail-fixture",
            tenant_id=_TENANT,
            case_id=uuid4(),
            confidence=0.9,
            citations=["CriteriaCorp/fixture/v2024"],
            abstained=False,
            result={"gaps": []},
            provenance=_PROVENANCE,
        )
        for _ in range(10)
    ]
    return invalid, valid


def compute_guardrail_metrics() -> dict[str, dict]:
    """Run the 20-fixture set through GuardrailEngine and return block_rate + fp_rate."""
    engine = GuardrailEngine()
    invalid, valid = _make_fixtures()

    blocked_invalid = sum(1 for f in invalid if not engine.check(f, _TENANT).passed)
    blocked_valid = sum(1 for f in valid if not engine.check(f, _TENANT).passed)

    block_rate = blocked_invalid / len(invalid)
    fp_rate = blocked_valid / len(valid)

    return {
        "guardrail_block_rate": {
            "score": round(block_rate, 4),
            "threshold": THRESHOLDS["guardrail_block_rate"],
            "passed": block_rate >= THRESHOLDS["guardrail_block_rate"],
        },
        "guardrail_fp_rate": {
            "score": round(fp_rate, 4),
            "threshold": THRESHOLDS["guardrail_fp_rate"],
            "passed": fp_rate <= THRESHOLDS["guardrail_fp_rate"],
        },
    }

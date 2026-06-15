"""Tests for the CompletenessAgent LangGraph graph.

Key invariants tested here:
- GuardrailEngine runs on EVERY output (never skipped)
- Adverse keyword in output causes guardrail to block
- Parse errors and low-confidence outputs cause abstention (not errors)
"""
from __future__ import annotations

import json
import pytest
from uuid import uuid4

# Import shared fixtures and constants from conftest
from tests.conftest import (
    ADVERSE_RESPONSE,
    INVALID_JSON_RESPONSE,
    LOW_CONFIDENCE_RESPONSE,
    VALID_RESPONSE,
    MockAdapter,
)


def _make_input(tenant_id: str = "tenant-abc") -> dict:
    return {
        "tenant_id": tenant_id,
        "case_id": uuid4(),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "standard",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report", "clinical_notes"],
        "correlation_id": "corr-test-001",
    }


async def test_completeness_valid_json_produces_non_abstained_output() -> None:
    """Happy path: valid high-confidence JSON → non-abstained AgentOutput, guardrail passes."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    guardrail = final["guardrail_result"]

    assert output.abstained is False
    assert output.confidence == 0.85
    assert output.citations == ["CriteriaCorp SR-2024"]
    assert output.result is not None
    assert guardrail.passed is True
    assert guardrail.violations == []
    # Provenance is recorded
    assert output.provenance["model_name"] == "test-model"
    assert "input_hash" in output.provenance
    assert "timestamp" in output.provenance


async def test_completeness_invalid_json_produces_abstained_output() -> None:
    """Invalid model response → parse error → abstained=True, result=None."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(INVALID_JSON_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert output.abstention_reason is not None
    assert "parse_error" in output.abstention_reason


async def test_completeness_low_confidence_produces_abstained_output() -> None:
    """Confidence < 0.4 → abstained=True (correct behaviour, not a bug)."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(LOW_CONFIDENCE_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.confidence == 0.3
    assert output.result is None


async def test_completeness_adverse_output_guardrail_fires() -> None:
    """INVARIANT: Adverse keyword in agent result → GuardrailEngine passes=False."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(ADVERSE_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input())

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    guardrail = final["guardrail_result"]
    assert guardrail.passed is False
    assert any("no_autonomous_adverse" in v for v in guardrail.violations)


async def test_guardrail_result_always_present_in_final_state() -> None:
    """INVARIANT: guardrail_result must be populated for every graph execution."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    for response in [VALID_RESPONSE, INVALID_JSON_RESPONSE, LOW_CONFIDENCE_RESPONSE, ADVERSE_RESPONSE]:
        adapter = MockAdapter(response)
        graph = build_graph(adapter)
        inp = AgentInput.model_validate(_make_input())

        final = await graph.ainvoke(
            {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
        )

        assert final["guardrail_result"] is not None, (
            f"guardrail_result was None for response: {response[:40]}"
        )


async def test_completeness_tenant_id_propagated_to_output() -> None:
    """tenant_id from AgentInput must match AgentOutput.tenant_id (invariant #5)."""
    from enstellar_agents.agents.completeness import build_graph
    from enstellar_agents.models import AgentInput

    adapter = MockAdapter(VALID_RESPONSE)
    graph = build_graph(adapter)
    inp = AgentInput.model_validate(_make_input(tenant_id="tenant-xyz"))

    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    assert final["agent_output"].tenant_id == "tenant-xyz"

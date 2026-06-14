"""Tests for the TriageAgent LangGraph graph and POST /assist/triage endpoint."""
from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import MockAdapter
from enstellar_agents.agents.triage import build_triage_graph
from enstellar_agents.models import AgentInput

pytestmark = pytest.mark.asyncio

# ---------------------------------------------------------------------------
# Test response fixtures
# ---------------------------------------------------------------------------

VALID_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "expedited",
        "rationale": "Urgency=expedited and procedure 27447 requires specialist review.",
        "confidence": 0.82,
        "citations": ["urgency=expedited", "CPT 27447"],
    }
)

LOW_CONFIDENCE_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "standard",
        "rationale": "Insufficient information.",
        "confidence": 0.25,
        "citations": [],
    }
)

ADVERSE_TRIAGE_RESPONSE = json.dumps(
    {
        "suggested_queue": "standard",
        "rationale": "The claim appears denied as not medically necessary.",
        "confidence": 0.85,
        "citations": ["urgency=standard"],
    }
)

INVALID_JSON_TRIAGE_RESPONSE = "not valid json {"


def _make_input(**overrides) -> dict:
    defaults = {
        "tenant_id": "tenant-triage-test",
        "case_id": str(uuid.uuid4()),
        "case_summary": {
            "procedure_code": "27447",
            "diagnosis_codes": ["M17.11"],
            "urgency": "expedited",
            "lob": "commercial",
        },
        "doc_requirements": ["operative_report"],
        "correlation_id": "corr-triage-001",
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# TriageAgent graph tests
# ---------------------------------------------------------------------------


async def test_triage_agent_valid_json_returns_result() -> None:
    """Valid JSON response → non-abstained AgentOutput with suggested_queue in result."""
    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is False
    assert output.confidence == pytest.approx(0.82)
    assert output.result is not None
    assert output.result["suggested_queue"] == "expedited"
    assert "urgency=expedited" in output.citations


async def test_triage_agent_adverse_keyword_is_guardrail_blocked() -> None:
    """Result containing adverse keyword → guardrail fires → guardrail_result.passed=False."""
    adapter = MockAdapter(ADVERSE_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    gr = final["guardrail_result"]
    assert not gr.passed
    assert any("no_autonomous_adverse" in v for v in gr.violations)


async def test_triage_agent_low_confidence_abstains() -> None:
    """Confidence < 0.4 → agent sets abstained=True, result=None."""
    adapter = MockAdapter(LOW_CONFIDENCE_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert output.confidence == pytest.approx(0.25)
    assert output.abstention_reason == "low confidence"


async def test_triage_agent_invalid_json_abstains_with_parse_error() -> None:
    """Unparseable model output → abstained=True, abstention_reason contains 'parse_error'."""
    adapter = MockAdapter(INVALID_JSON_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    output = final["agent_output"]
    assert output.abstained is True
    assert output.result is None
    assert "parse_error" in (output.abstention_reason or "")


async def test_triage_agent_invalid_json_provenance_has_required_fields() -> None:
    """Parse-error path must still include model_name, input_hash, and timestamp in provenance."""
    adapter = MockAdapter(INVALID_JSON_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    prov = final["agent_output"].provenance
    assert "model_name" in prov
    assert "input_hash" in prov
    assert "timestamp" in prov


async def test_triage_agent_provenance_has_model_name_and_hash() -> None:
    """AgentOutput.provenance must include model_name and input_hash."""
    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    prov = final["agent_output"].provenance
    assert "model_name" in prov
    assert "input_hash" in prov
    assert "timestamp" in prov


async def test_guardrail_result_always_present_in_final_state() -> None:
    """guardrail_result must never be None — guardrails cannot be skipped."""
    for response_text in [
        VALID_TRIAGE_RESPONSE,
        ADVERSE_TRIAGE_RESPONSE,
        LOW_CONFIDENCE_TRIAGE_RESPONSE,
        INVALID_JSON_TRIAGE_RESPONSE,
    ]:
        adapter = MockAdapter(response_text)
        graph = build_triage_graph(adapter)
        inp = AgentInput.model_validate(_make_input())
        final = await graph.ainvoke(
            {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
        )
        assert final["guardrail_result"] is not None, (
            f"guardrail_result was None for response {response_text[:40]!r} — "
            "guardrails must run unconditionally"
        )


async def test_triage_tenant_id_propagated_to_output() -> None:
    """tenant_id from input must be propagated to AgentOutput."""
    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input(tenant_id="tenant-propagation-check"))
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    assert final["agent_output"].tenant_id == "tenant-propagation-check"


async def test_triage_agent_valid_json_guardrail_passes() -> None:
    """Valid non-adverse output → guardrail_result.passed=True, violations=[]."""
    adapter = MockAdapter(VALID_TRIAGE_RESPONSE)
    graph = build_triage_graph(adapter)
    inp = AgentInput.model_validate(_make_input())
    final = await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    gr = final["guardrail_result"]
    assert gr.passed is True
    assert gr.violations == []


# ---------------------------------------------------------------------------
# POST /assist/triage router tests
# ---------------------------------------------------------------------------


async def test_assist_triage_happy_path_returns_200(monkeypatch) -> None:
    """POST /assist/triage with valid JSON model response → 200 with non-abstained AgentOutput."""
    from enstellar_agents.main import app

    monkeypatch.setattr(
        "enstellar_agents.routers.assist.get_adapter",
        lambda _: MockAdapter(VALID_TRIAGE_RESPONSE),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=_make_input())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["abstained"] is False
    assert body["result"]["suggested_queue"] == "expedited"


async def test_assist_triage_guardrail_block_returns_abstained(monkeypatch) -> None:
    """POST /assist/triage with adverse keyword → 200 with abstained=True."""
    from enstellar_agents.main import app

    monkeypatch.setattr(
        "enstellar_agents.routers.assist.get_adapter",
        lambda _: MockAdapter(ADVERSE_TRIAGE_RESPONSE),
    )

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=_make_input())

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["abstained"] is True
    assert body["result"] is None
    assert "no_autonomous_adverse" in (body.get("abstention_reason") or "")


async def test_assist_triage_missing_tenant_id_returns_422() -> None:
    """POST /assist/triage with blank tenant_id → 422."""
    from enstellar_agents.main import app

    payload = _make_input()
    payload["tenant_id"] = ""  # blank → fails AgentInput validator

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/assist/triage", json=payload)

    assert r.status_code == 422

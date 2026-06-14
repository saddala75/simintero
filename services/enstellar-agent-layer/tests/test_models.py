"""Unit tests for all Pydantic models in enstellar_agents.models."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from uuid import UUID, uuid4


def _sample_agent_input_data() -> dict:
    return {
        "tenant_id": "tenant-xyz",
        "case_id": str(uuid4()),
        "case_summary": {"procedure_code": "27447", "diagnosis_codes": ["M17.11"]},
        "doc_requirements": ["operative_report"],
        "correlation_id": "corr-999",
    }


def _sample_agent_output_data(case_id: str) -> dict:
    return {
        "agent_id": "completeness-v1",
        "tenant_id": "tenant-xyz",
        "case_id": case_id,
        "confidence": 0.85,
        "citations": ["CriteriaCorp SR-2024"],
        "abstained": False,
        "abstention_reason": None,
        "result": {"gaps": []},
        "provenance": {
            "model_name": "llama3",
            "input_hash": "abc123def456",
            "timestamp": "2026-06-06T00:00:00+00:00",
        },
    }


def test_agent_input_round_trip() -> None:
    from enstellar_agents.models import AgentInput

    data = _sample_agent_input_data()
    obj = AgentInput.model_validate(data)
    assert obj.tenant_id == "tenant-xyz"
    assert isinstance(obj.case_id, UUID)
    assert obj.doc_requirements == ["operative_report"]
    # Round-trip through JSON
    assert AgentInput.model_validate_json(obj.model_dump_json()).tenant_id == "tenant-xyz"


def test_agent_input_blank_tenant_id_raises() -> None:
    from enstellar_agents.models import AgentInput

    data = _sample_agent_input_data()
    data["tenant_id"] = ""
    with pytest.raises(ValidationError, match="tenant_id"):
        AgentInput.model_validate(data)


def test_agent_output_round_trip() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    obj = AgentOutput.model_validate(data)
    assert obj.abstained is False
    assert obj.confidence == 0.85
    assert obj.citations == ["CriteriaCorp SR-2024"]
    assert AgentOutput.model_validate_json(obj.model_dump_json()).agent_id == "completeness-v1"


def test_agent_output_abstained_has_no_result() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    data["abstained"] = True
    data["abstention_reason"] = "low confidence"
    data["result"] = None
    obj = AgentOutput.model_validate(data)
    assert obj.result is None
    assert obj.abstention_reason == "low confidence"


def test_agent_output_abstained_with_result_raises() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    data["abstained"] = True
    data["result"] = {"something": "here"}
    with pytest.raises(ValidationError):
        AgentOutput.model_validate(data)


def test_agent_output_blank_tenant_id_raises() -> None:
    from enstellar_agents.models import AgentOutput

    case_id = str(uuid4())
    data = _sample_agent_output_data(case_id)
    data["tenant_id"] = ""
    with pytest.raises(ValidationError, match="tenant_id"):
        AgentOutput.model_validate(data)


def test_guardrail_result_passed_round_trip() -> None:
    from enstellar_agents.models import GuardrailResult

    obj = GuardrailResult(passed=True, violations=[])
    assert GuardrailResult.model_validate_json(obj.model_dump_json()).passed is True


def test_guardrail_result_failed_preserves_violations() -> None:
    from enstellar_agents.models import GuardrailResult

    obj = GuardrailResult(passed=False, violations=["no_autonomous_adverse: found 'denied'"])
    assert obj.violations[0].startswith("no_autonomous_adverse")


def test_completion_gap_round_trip() -> None:
    from enstellar_agents.models import CompletionGap

    obj = CompletionGap(
        gap_id="gap-1",
        description="Missing operative report",
        required_document_type="operative_report",
        citations=["CriteriaCorp SR-2024"],
    )
    assert CompletionGap.model_validate_json(obj.model_dump_json()).gap_id == "gap-1"


def test_rfi_draft_round_trip() -> None:
    from enstellar_agents.models import RfiDraft

    obj = RfiDraft(
        subject="Documentation Request",
        body="Please provide the requested documents.",
        required_documents=["operative_report"],
        due_date_days=14,
    )
    assert RfiDraft.model_validate_json(obj.model_dump_json()).due_date_days == 14

"""Contract tests for EventEnvelope — ensure schema enforces required fields."""
import json
from pathlib import Path

import pytest

SCHEMA_PATH = Path(__file__).parent.parent / "schema" / "event_envelope.json"


def test_schema_file_exists():
    assert SCHEMA_PATH.exists(), "event_envelope.json must exist"


def test_schema_has_all_required_fields():
    schema = json.loads(SCHEMA_PATH.read_text())
    required = set(schema["required"])
    expected = {
        "event_id", "tenant_id", "correlation_id",
        "type", "occurred_at", "actor", "payload", "schema_version",
    }
    assert expected.issubset(required), f"Missing required fields: {expected - required}"


def test_schema_tenant_id_in_required():
    schema = json.loads(SCHEMA_PATH.read_text())
    assert "tenant_id" in schema["required"], "tenant_id must be required — invariant #5"


from enstellar_events.envelope import EventEnvelope, Actor, ActorType


SAMPLE_EVENT = {
    "event_id": "aaaaaaaa-0000-0000-0000-000000000001",
    "tenant_id": "tenant-test",
    "case_id": "bbbbbbbb-0000-0000-0000-000000000002",
    "correlation_id": "corr-xyz-789",
    "type": "case.state.transitioned",
    "occurred_at": "2026-06-05T10:00:00Z",
    "actor": {"id": "user-123", "type": "user"},
    "payload": {"from_state": "intake", "to_state": "completeness_check"},
    "schema_version": "1.0.0",
}


def test_event_envelope_roundtrip():
    env = EventEnvelope.model_validate(SAMPLE_EVENT)
    json_str = env.model_dump_json()
    restored = EventEnvelope.model_validate_json(json_str)
    assert restored == env


def test_event_without_tenant_id_raises():
    import pydantic
    bad = {k: v for k, v in SAMPLE_EVENT.items() if k != "tenant_id"}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)


def test_event_without_case_id_is_valid():
    no_case = {k: v for k, v in SAMPLE_EVENT.items() if k != "case_id"}
    env = EventEnvelope.model_validate(no_case)
    assert env.case_id is None


def test_invalid_event_type_pattern_raises():
    import pydantic
    bad = {**SAMPLE_EVENT, "type": "NotDotSeparated"}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)


def test_empty_tenant_id_raises():
    import pydantic
    bad = {**SAMPLE_EVENT, "tenant_id": ""}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)


def test_topics_rfi_dispatched_constant():
    from enstellar_events import Topics
    assert Topics.RFI_DISPATCHED == "rfi.dispatched"


def test_topics_all_clock_constants_present():
    from enstellar_events import Topics
    assert Topics.CLOCK_STARTED == "clock.started"
    assert Topics.CLOCK_PAUSED == "clock.paused"
    assert Topics.CLOCK_RESUMED == "clock.resumed"
    assert Topics.CLOCK_BREACHED == "clock.breached"

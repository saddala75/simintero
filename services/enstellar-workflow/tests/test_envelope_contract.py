"""Smoke test: events produced by workflow-engine conform to the envelope schema."""
import uuid
from datetime import datetime, timezone

import pytest

from enstellar_events import EventEnvelope, Actor, ActorType, SchemaRef, encode, decode


def _make_event(**overrides) -> dict:
    base = {
        "event_id": str(uuid.uuid4()),
        "tenant_id": "tenant-test",
        "case_id": str(uuid.uuid4()),
        "correlation_id": "corr-001",
        "schema_ref": SchemaRef.CASE_STATE_CHANGED,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "actor": {"id": "system", "type": "system"},
        "payload": {"from_state": "intake", "to_state": "completeness_check"},
    }
    return {**base, **overrides}


def test_valid_event_parses():
    env = EventEnvelope.model_validate(_make_event())
    assert env.tenant_id == "tenant-test"


def test_encode_decode_roundtrip():
    env = EventEnvelope.model_validate(_make_event())
    assert decode(encode(env)) == env


def test_event_without_tenant_id_rejected():
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(_make_event(tenant_id=""))

"""Smoke test: events produced by workflow-engine conform to the platform envelope."""
import json

import pytest

from canonical_model import EventEnvelope
from simintero_outbox import SchemaRef, make_envelope


def _make_event(**overrides):
    kwargs = {
        "schema_ref": SchemaRef.CASE_STATE_CHANGED,
        "tenant_id": "tenant-test",
        "actor_id": "system",
        "actor_type": "system",
        "correlation_id": "corr-001",
        "payload": {
            "case_id": "11111111-1111-1111-1111-111111111111",
            "from_state": "intake",
            "to_state": "completeness_check",
        },
    }
    kwargs.update(overrides)
    return make_envelope(**kwargs)


def test_valid_event_builds():
    env = _make_event()
    assert env.tenant.tenant_id == "tenant-test"
    assert env.event_id.startswith("evt_")
    assert env.actor.type.value == "service"  # system → service


def test_json_roundtrip():
    env = _make_event()
    raw = json.loads(env.model_dump_json())
    assert EventEnvelope.model_validate(raw) == env


def test_actor_type_mapping():
    env = _make_event(actor_type="user")
    assert env.actor.type.value == "human"

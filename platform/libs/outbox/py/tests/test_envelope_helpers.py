import re
from simintero_outbox import new_event_id, make_envelope, map_actor_type
from canonical_model import EventEnvelope

def test_new_event_id_is_ulid():
    eid = new_event_id()
    assert re.fullmatch(r"evt_[0-9A-Z]{26}", eid), eid

def test_actor_type_maps_old_to_platform():
    assert map_actor_type("user") == "human"
    assert map_actor_type("system") == "service"
    assert map_actor_type("service") == "service"
    assert map_actor_type("model_agent") == "model_agent"

def test_make_envelope_builds_valid_platform_envelope():
    env = make_envelope(
        "sim.case.lifecycle/CaseStateChanged/v1",
        tenant_id="t_acme", lob="MA",
        actor_id="workflow-engine", actor_type="system",
        correlation_id="case_123",
        payload={"from_status": "intake", "to_status": "completeness_check"},
    )
    assert isinstance(env, EventEnvelope)
    assert env.event_id.startswith("evt_")
    assert env.tenant.tenant_id == "t_acme"
    assert env.tenant.lob == "MA"
    assert env.actor.type == "service"   # system -> service
    assert env.correlation_id == "case_123"
    EventEnvelope.model_validate(env.model_dump(mode="json"))

import pytest
from simintero_outbox.topics import topic_for

def test_prefix_routing_matches_ts_contract():
    assert topic_for("sim.case.state-changed/CaseStateChanged/v1") == "sim.case.lifecycle"
    assert topic_for("sim.evidence.added/EvidenceAdded/v1") == "sim.evidence"
    assert topic_for("sim.artifact.activated/X/v1") == "sim.artifact"
    assert topic_for("sim.ai.interaction/X/v1") == "sim.ai.interaction"
    assert topic_for("sim.clock.breached/X/v1") == "sim.clock"
    assert topic_for("sim.tenant.provisioned/X/v1") == "sim.tenant.admin"

def test_unknown_prefix_raises():
    with pytest.raises(ValueError):
        topic_for("sim.unknown.thing/X/v1")

import pytest
from simintero_outbox.topics import topic_for

def test_first_segment_routing_matches_c3_contract():
    assert topic_for("sim.case.lifecycle/CaseStateChanged/v1") == "sim.case.lifecycle"
    assert topic_for("sim.clock/ClockStarted/v1") == "sim.clock"
    assert topic_for("sim.artifact/NotificationSent/v1") == "sim.artifact"
    assert topic_for("sim.ai.interaction/AgentAssistProduced/v1") == "sim.ai.interaction"
    assert topic_for("sim.tenant.admin/TenantProvisioned/v1") == "sim.tenant.admin"
    assert topic_for("sim.evidence/EvidenceAdded/v1") == "sim.evidence"

def test_unknown_topic_raises():
    with pytest.raises(ValueError):
        topic_for("sim.bogus/X/v1")

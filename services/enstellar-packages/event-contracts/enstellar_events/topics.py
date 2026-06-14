"""C-3 event schema references and Kafka topic constants.

C-3 format: ``topic/EventName/version``  e.g. ``sim.case.lifecycle/CaseStateChanged/v1``
The Kafka topic is the first path segment (before the first ``/``).
"""


class SchemaRef:
    """C-3 schema reference constants (format: topic/EventName/version)."""

    CASE_INTAKE_RECEIVED = "sim.case.lifecycle/CaseIntakeReceived/v1"
    CASE_STATE_CHANGED = "sim.case.lifecycle/CaseStateChanged/v1"
    CASE_PENDED = "sim.case.lifecycle/CasePended/v1"
    CASE_ASSIGNED = "sim.case.lifecycle/CaseAssigned/v1"
    CASE_CLOSED = "sim.case.lifecycle/CaseClosed/v1"
    DECISION_RECORDED = "sim.case.lifecycle/DecisionRecorded/v1"
    CASE_NORMALIZED = "sim.case.lifecycle/CaseNormalized/v1"
    ADVERSE_STRUCTURED = "sim.case.lifecycle/AdverseDetermination/v1"
    RFI_REQUESTED = "sim.case.lifecycle/RFIRequested/v1"
    RFI_DISPATCHED = "sim.case.lifecycle/RFIDispatched/v1"
    RFI_RESPONSE_RECEIVED = "sim.case.lifecycle/RFIResponseReceived/v1"

    CLOCK_STARTED = "sim.clock/ClockStarted/v1"
    CLOCK_PAUSED = "sim.clock/ClockPaused/v1"
    CLOCK_RESUMED = "sim.clock/ClockResumed/v1"
    CLOCK_BREACHED = "sim.clock/ClockBreached/v1"
    CLOCK_STOPPED = "sim.clock/ClockStopped/v1"

    AGENT_ASSIST_PRODUCED = "sim.ai.interaction/AgentAssistProduced/v1"
    AGENT_ASSIST_FAILED = "sim.ai.interaction/AgentAssistFailed/v1"

    NOTIFICATION_SENT = "sim.artifact/NotificationSent/v1"


class Topics:
    """Kafka topic constants — the first path segment of any SchemaRef."""

    CASE_LIFECYCLE = "sim.case.lifecycle"
    CLOCK = "sim.clock"
    AI_INTERACTION = "sim.ai.interaction"
    ARTIFACT = "sim.artifact"
    TENANT_ADMIN = "sim.tenant.admin"


def topic_for(schema_ref: str) -> str:
    """Return the Kafka topic for a C-3 schema_ref (first segment before '/')."""
    return schema_ref.split("/")[0]

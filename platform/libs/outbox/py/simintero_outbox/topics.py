from __future__ import annotations

_PREFIX_TO_TOPIC = [
    ("sim.case.", "sim.case.lifecycle"),
    ("sim.evidence.", "sim.evidence"),
    ("sim.artifact.", "sim.artifact"),
    ("sim.ai.", "sim.ai.interaction"),
    ("sim.clock.", "sim.clock"),
    ("sim.tenant.", "sim.tenant.admin"),
]

def topic_for(schema_ref: str) -> str:
    """Route a schema_ref to its Kafka topic by prefix (matches outbox/ts)."""
    for prefix, topic in _PREFIX_TO_TOPIC:
        if schema_ref.startswith(prefix):
            return topic
    raise ValueError(f"Unknown schema_ref prefix: {schema_ref}")

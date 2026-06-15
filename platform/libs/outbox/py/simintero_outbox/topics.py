from __future__ import annotations

# The C-3 channels (Kafka topics). A schema_ref is "<topic>/<EventName>/v<N>",
# so the topic is the first path segment.
_KNOWN_TOPICS = frozenset({
    "sim.case.lifecycle",
    "sim.evidence",
    "sim.artifact",
    "sim.ai.interaction",
    "sim.clock",
    "sim.tenant.admin",
})

def topic_for(schema_ref: str) -> str:
    """Return the Kafka topic for a C-3 schema_ref (the first '/'-segment)."""
    topic = schema_ref.split("/", 1)[0]
    if topic not in _KNOWN_TOPICS:
        raise ValueError(f"Unknown C-3 topic in schema_ref: {schema_ref!r}")
    return topic

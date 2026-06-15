"""Serialize / deserialize EventEnvelope to/from bytes (UTF-8 JSON)."""
import json as _json

from .envelope import EventEnvelope

# Fields produced by @computed_field serialization; not accepted as constructor args.
_COMPUTED = frozenset({"type", "schema_version"})


def encode(event: EventEnvelope) -> bytes:
    return event.model_dump_json().encode("utf-8")


def decode(data: bytes) -> EventEnvelope:
    raw = _json.loads(data.decode("utf-8"))
    for key in _COMPUTED:
        raw.pop(key, None)
    return EventEnvelope.model_validate(raw)

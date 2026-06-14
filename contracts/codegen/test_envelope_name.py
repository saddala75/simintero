import sys
from pathlib import Path

def test_envelope_class_is_named_eventenvelope():
    sys.path.insert(0, str(Path(__file__).parent.parent / "generated" / "python"))
    import canonical_model
    assert hasattr(canonical_model, "EventEnvelope"), "envelope root type must be exported as EventEnvelope"

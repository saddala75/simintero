import json
from pathlib import Path

def test_case_roundtrips_through_generated_model():
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "generated" / "python"))
    from canonical_model import Case  # generated

    fixture = json.loads((Path(__file__).parent / "fixtures" / "case.json").read_text())
    case = Case.model_validate(fixture)
    assert case.model_dump(mode="json", by_alias=True)["case_id"] == fixture["case_id"]

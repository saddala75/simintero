import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "generated" / "python"))
from canonical_model import Case  # generated


def _fixture():
    return json.loads((Path(__file__).parent / "fixtures" / "case.json").read_text())


def test_case_roundtrips_case_id():
    fx = _fixture()
    case = Case.model_validate(fx)
    assert case.model_dump(mode="json", by_alias=True)["case_id"] == fx["case_id"]


def test_case_roundtrips_nested_values():
    """Guard that nested models (member, coverage, service_lines, ...) actually
    parse and round-trip -- not just the top-level case_id."""
    fx = _fixture()
    dumped = Case.model_validate(fx).model_dump(mode="json", by_alias=True)

    # member nested model
    assert dumped["member"]["member_id"] == fx["member"]["member_id"]
    assert dumped["member"]["mrn"] == fx["member"]["mrn"]
    # nested list inside member round-trips fully
    assert dumped["member"]["identifiers"] == fx["member"]["identifiers"]

    # coverage nested model
    assert dumped["coverage"]["coverage_id"] == fx["coverage"]["coverage_id"]
    assert dumped["coverage"]["plan_id"] == fx["coverage"]["plan_id"]

    # provider nested models
    assert (
        dumped["requesting_provider"]["provider_id"]
        == fx["requesting_provider"]["provider_id"]
    )

    # service_lines nested list -- every fixture key/value present in the dumped
    # output (extra default-injected keys allowed) for each element.
    assert len(dumped["service_lines"]) == len(fx["service_lines"])
    for dumped_line, fx_line in zip(dumped["service_lines"], fx["service_lines"]):
        assert dumped_line == {**dumped_line, **fx_line}

    # decisions round-trip when present in the fixture.
    if fx.get("decisions"):
        assert len(dumped["decisions"]) == len(fx["decisions"])

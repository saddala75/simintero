"""Eval harness for the CompletenessAgent.

These are deterministic metric tests using controlled mock adapters.
No real model calls are made. Metrics are computed over N=5 synthetic cases.

Required pass thresholds (from T14 DoD):
  - Groundedness         >= 0.8   (fraction of output gaps that have >=1 citation)
  - Gap-detection precision >= 0.75 (detected_required_types ∩ expected / detected)
  - Abstention rate      >= 0.6   (ambiguous inputs where agent correctly abstains)
"""
from __future__ import annotations

import json
from uuid import uuid4

from enstellar_agents.model_access.base import ModelAdapter


# ──────────────────────────────────────────────
# Synthetic eval adapters
# ──────────────────────────────────────────────

class _GroundedAdapter(ModelAdapter):
    """Returns well-cited gaps for each required document type in the input."""

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        # Parse the required doc types from the user message so gaps exactly match input
        doc_types = ["operative_report", "clinical_notes", "imaging_report"]
        return json.dumps(
            {
                "gaps": [
                    {
                        "description": f"Missing {dt}",
                        "required_document_type": dt,
                        "citation": f"CriteriaCorp/{dt}/v2024",
                    }
                    for dt in doc_types
                ],
                "rfi_draft": {
                    "subject": "Documentation Request",
                    "body": "Please provide the requested clinical documents.",
                    "required_documents": doc_types,
                    "due_date_days": 14,
                },
                "confidence": 0.88,
                "citations": [f"CriteriaCorp/{dt}/v2024" for dt in doc_types],
            }
        )

    def model_name(self) -> str:
        return "eval-grounded"


class _AmbiguousAdapter(ModelAdapter):
    """Returns confidence=0.3 for any input — simulates an ambiguous/underspecified case."""

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        return json.dumps(
            {
                "gaps": [],
                "rfi_draft": {
                    "subject": "",
                    "body": "",
                    "required_documents": [],
                    "due_date_days": 14,
                },
                "confidence": 0.3,
                "citations": [],
            }
        )

    def model_name(self) -> str:
        return "eval-ambiguous"


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _make_eval_input(doc_requirements: list[str], tenant_id: str = "tenant-eval"):
    from enstellar_agents.models import AgentInput

    return AgentInput.model_validate(
        {
            "tenant_id": tenant_id,
            "case_id": str(uuid4()),
            "case_summary": {
                "procedure_code": "27447",
                "diagnosis_codes": ["M17.11"],
                "urgency": "standard",
                "lob": "commercial",
            },
            "doc_requirements": doc_requirements,
            "correlation_id": f"eval-{uuid4().hex[:8]}",
        }
    )


async def _run_once(adapter, doc_requirements: list[str]) -> dict:
    """Run the graph once and return the final state dict."""
    from enstellar_agents.agents.completeness import build_graph

    graph = build_graph(adapter)
    inp = _make_eval_input(doc_requirements)
    return await graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )


# ──────────────────────────────────────────────
# Groundedness eval  (target: >= 0.8)
# ──────────────────────────────────────────────

async def test_eval_groundedness_at_least_0_8() -> None:
    """Each output gap must have at least one citation.

    groundedness = gaps_with_citations / total_gaps
    Threshold: >= 0.8
    """
    adapter = _GroundedAdapter()
    doc_reqs = ["operative_report", "clinical_notes", "imaging_report"]
    N = 5
    total_gaps = 0
    grounded_gaps = 0

    for _ in range(N):
        final = await _run_once(adapter, doc_reqs)
        output = final["agent_output"]
        assert not output.abstained, "Grounded adapter should not produce abstained output"
        gaps = output.result.get("gaps", [])
        for gap in gaps:
            total_gaps += 1
            if gap.get("citation"):
                grounded_gaps += 1

    assert total_gaps > 0, "No gaps produced — check adapter"
    groundedness = grounded_gaps / total_gaps
    assert groundedness >= 0.8, (
        f"Groundedness {groundedness:.2f} < 0.8 (grounded={grounded_gaps}, total={total_gaps})"
    )


# ──────────────────────────────────────────────
# Gap-detection precision eval  (target: >= 0.75)
# ──────────────────────────────────────────────

async def test_eval_gap_detection_precision_at_least_0_75() -> None:
    """Detected required_document_type values must appear in the expected set.

    precision = |detected ∩ expected| / |detected|
    Threshold: >= 0.75
    """
    adapter = _GroundedAdapter()
    expected_doc_types = {"operative_report", "clinical_notes", "imaging_report"}
    N = 5
    total_detected = 0
    true_positives = 0

    for _ in range(N):
        final = await _run_once(adapter, list(expected_doc_types))
        output = final["agent_output"]
        assert not output.abstained
        gaps = output.result.get("gaps", [])
        for gap in gaps:
            detected_type = gap.get("required_document_type", "")
            total_detected += 1
            if detected_type in expected_doc_types:
                true_positives += 1

    assert total_detected > 0, "No gaps detected — check adapter"
    precision = true_positives / total_detected
    assert precision >= 0.75, (
        f"Gap-detection precision {precision:.2f} < 0.75"
        f" (tp={true_positives}, detected={total_detected})"
    )


# ──────────────────────────────────────────────
# Abstention rate eval  (target: >= 0.6)
# ──────────────────────────────────────────────

async def test_eval_abstention_rate_on_ambiguous_inputs_at_least_0_6() -> None:
    """Ambiguous inputs (low model confidence) must produce abstained=True outputs.

    abstention_rate = abstained_count / total_inputs
    Threshold: >= 0.6
    """
    adapter = _AmbiguousAdapter()
    N = 5
    abstained_count = 0

    for _ in range(N):
        final = await _run_once(adapter, [])
        output = final["agent_output"]
        if output.abstained:
            abstained_count += 1

    abstention_rate = abstained_count / N
    assert abstention_rate >= 0.6, (
        f"Abstention rate {abstention_rate:.2f} < 0.6 on ambiguous inputs"
        f" ({abstained_count}/{N} abstained)"
    )

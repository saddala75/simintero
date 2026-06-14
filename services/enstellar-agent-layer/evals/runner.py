"""Eval runner — loads dataset, invokes agents, computes metrics, generates report.

Usage:
    uv run --project services/agent-layer python -m evals.runner

Environment variables:
    EVAL_ADAPTER   mock (default) | anthropic
    EVAL_MODEL     optional model override (e.g. claude-haiku-4-5-20251001)
    ANTHROPIC_API_KEY  required when EVAL_ADAPTER=anthropic
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from uuid import uuid4

from enstellar_agents.agents.completeness import build_graph as build_completeness_graph
from enstellar_agents.agents.triage import build_triage_graph
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.models import AgentInput, AgentOutput

from evals.dataset.base import EvalCase
from evals.dataset.synthetic import SyntheticDatasetLoader
from evals.metrics.completeness import compute_completeness_metrics
from evals.metrics.guardrails import compute_guardrail_metrics
from evals.metrics.triage import compute_triage_metrics
from evals.report import generate_report

logger = logging.getLogger(__name__)


# ── Private mock adapters ────────────────────────────────────────────────────

class _CompGroundedAdapter(ModelAdapter):
    """Mock completeness adapter for non-ambiguous cases.

    Parses 'Required document types: a, b, c' from the user message and
    returns each as a gap with a citation. confidence=0.88 (above all thresholds).
    """

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        match = re.search(r"Required document types: (.+)$", user_message, re.MULTILINE)
        doc_types = [d.strip() for d in match.group(1).split(",")] if match else []
        return json.dumps({
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
                "body": "Please provide the required clinical documentation.",
                "required_documents": doc_types,
                "due_date_days": 14,
            },
            "confidence": 0.88,
            "citations": [f"CriteriaCorp/{dt}/v2024" for dt in doc_types],
        })

    def model_name(self) -> str:
        return "eval-comp-grounded"


class _CompAmbiguousAdapter(ModelAdapter):
    """Mock completeness adapter for ambiguous cases.

    Returns confidence=0.3 — the completeness agent's parse_output node
    sets abstained=True because 0.3 < 0.4 (abstention threshold).
    """

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        return json.dumps({
            "gaps": [],
            "rfi_draft": {"subject": "", "body": "", "required_documents": [], "due_date_days": 14},
            "confidence": 0.3,
            "citations": [],
        })

    def model_name(self) -> str:
        return "eval-comp-ambiguous"


class _TriageMockAdapter(ModelAdapter):
    """Mock triage adapter for all cases.

    Parses 'urgency' from case_summary JSON and maps it to the expected queue.
    confidence=0.88 (above all thresholds) — never abstains.
    """

    _QUEUE_MAP = {
        "standard": "clinical_review",
        "expedited": "medical_director",
        "concurrent": "auto_approve",
    }

    async def complete(self, system_prompt: str, user_message: str) -> str:  # noqa: ARG002
        match = re.search(r"Case summary: (\{.+\})", user_message, re.DOTALL)
        case_summary = json.loads(match.group(1)) if match else {}
        urgency = case_summary.get("urgency", "standard")
        queue = self._QUEUE_MAP.get(urgency, "clinical_review")
        return json.dumps({
            "suggested_queue": queue,
            "rationale": f"Routing to {queue} based on urgency={urgency}",
            "confidence": 0.88,
            "citations": [f"RoutingPolicy/urgency/{urgency}"],
        })

    def model_name(self) -> str:
        return "eval-triage"


# ── Adapter factory ──────────────────────────────────────────────────────────

def _get_real_adapter(eval_model: str | None) -> ModelAdapter:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter

    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ENSTELLAR_ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY is required when EVAL_ADAPTER=anthropic")

    settings = AgentSettings(
        model_provider="anthropic",
        model_name=eval_model or "claude-haiku-4-5-20251001",
        anthropic_api_key=api_key,
    )
    return get_adapter(settings)


# ── Per-case invocation ──────────────────────────────────────────────────────

async def _invoke_case(
    case: EvalCase,
    comp_adapter: ModelAdapter,
    triage_adapter: ModelAdapter,
) -> tuple[AgentOutput, AgentOutput]:
    inp = AgentInput(
        tenant_id="tenant-eval",
        case_id=uuid4(),
        case_summary={
            "procedure_code": case.procedure_codes[0] if case.procedure_codes else "",
            "diagnosis_codes": case.diagnosis_codes,
            "urgency": case.urgency,
            "lob": case.lob,
        },
        doc_requirements=case.doc_requirements,
        correlation_id=f"eval-{case.case_id}",
    )

    comp_graph = build_completeness_graph(comp_adapter)
    comp_state = await comp_graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    triage_graph = build_triage_graph(triage_adapter)
    triage_state = await triage_graph.ainvoke(
        {"inp": inp, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )

    return comp_state["agent_output"], triage_state["agent_output"]


# ── Main pipeline ────────────────────────────────────────────────────────────

async def _run_all(
    eval_adapter_name: str,
    eval_model: str | None,
) -> tuple[list[AgentOutput], list[AgentOutput], list[EvalCase]]:
    """Run the full eval pipeline and return (comp_outputs, triage_outputs, cases)."""
    loader = SyntheticDatasetLoader()
    cases = loader.load()

    real_adapter: ModelAdapter | None = None
    if eval_adapter_name == "anthropic":
        real_adapter = _get_real_adapter(eval_model)
    elif eval_adapter_name != "mock":
        raise ValueError(f"Unknown EVAL_ADAPTER: {eval_adapter_name!r}. Use 'mock' or 'anthropic'.")

    triage_adapter = _TriageMockAdapter() if eval_adapter_name == "mock" else real_adapter

    comp_outputs: list[AgentOutput] = []
    triage_outputs: list[AgentOutput] = []

    for case in cases:
        if eval_adapter_name == "mock":
            comp_adapter: ModelAdapter = (
                _CompAmbiguousAdapter() if case.should_abstain else _CompGroundedAdapter()
            )
        else:
            comp_adapter = real_adapter  # type: ignore[assignment]

        comp_out, triage_out = await _invoke_case(case, comp_adapter, triage_adapter)
        comp_outputs.append(comp_out)
        triage_outputs.append(triage_out)
        logger.debug("eval case=%s abstained=%s queue=%s", case.case_id, comp_out.abstained,
                     triage_out.result.get("suggested_queue") if triage_out.result else None)

    return comp_outputs, triage_outputs, cases


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    eval_adapter_name = os.environ.get("EVAL_ADAPTER", "mock")
    eval_model = os.environ.get("EVAL_MODEL")

    comp_outputs, triage_outputs, cases = asyncio.run(_run_all(eval_adapter_name, eval_model))

    comp_metrics = compute_completeness_metrics(comp_outputs, cases)
    triage_metrics = compute_triage_metrics(triage_outputs, cases)
    guardrail_metrics = compute_guardrail_metrics()
    all_metrics = {**comp_metrics, **triage_metrics, **guardrail_metrics}

    loader = SyntheticDatasetLoader()
    generate_report(
        metrics=all_metrics,
        cases=cases,
        comp_outputs=comp_outputs,
        triage_outputs=triage_outputs,
        adapter=eval_adapter_name,
        model=eval_model,
        dataset_version=loader.version,
    )

    all_passed = all(v["passed"] for v in all_metrics.values())
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())

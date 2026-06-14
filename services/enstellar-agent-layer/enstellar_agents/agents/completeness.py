"""CompletenessAgent — LangGraph typed graph for documentation gap detection.

Graph topology:
  call_model → parse_output → run_guardrails → END

The graph is advisory only:
  - It produces AgentOutput with confidence, citations, abstained flag, and provenance.
  - It NEVER writes to the workflow-engine or emits state-transition events.
  - GuardrailEngine runs unconditionally on every output.

PHI contract:
  - Only AgentInput.case_summary reaches the model — a pre-minimized dict.
  - Raw Case fields (member name, DOB, SSN, address) must not appear in case_summary.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import END, StateGraph

logger = logging.getLogger(__name__)

from enstellar_agents.guardrails.engine import GuardrailEngine
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.models import AgentInput, AgentOutput, GuardrailResult

SYSTEM_PROMPT = (
    "You are a clinical documentation completeness reviewer. "
    "Your job: identify gaps between submitted documentation and the required documents listed. "
    "You MUST NOT render a coverage determination or use denial/adverse language. "
    "Respond ONLY as valid JSON with this exact structure:\n"
    '{"gaps": [{"description": "...", "required_document_type": "...", "citation": "..."}], '
    '"rfi_draft": {"subject": "...", "body": "...", "required_documents": ["..."], "due_date_days": 14}, '
    '"confidence": 0.0, "citations": ["..."]}\n'
    "confidence must be a float between 0.0 and 1.0. "
    "citations must reference specific clinical criteria or document guidelines."
)


class CompletenessState(TypedDict):
    inp: AgentInput
    raw_output: str
    agent_output: AgentOutput | None
    guardrail_result: GuardrailResult | None


def build_graph(adapter: ModelAdapter):
    """Compile a LangGraph StateGraph for the completeness agent.

    Args:
        adapter: The ModelAdapter to use for inference. Created by get_adapter(settings).

    Returns:
        A compiled LangGraph graph — call ``await graph.ainvoke(state)`` to run it.
    """

    async def _call_model(state: CompletenessState) -> CompletenessState:
        inp = state["inp"]
        user_msg = (
            f"Case summary: {json.dumps(inp.case_summary)}\n"
            f"Required document types: {', '.join(inp.doc_requirements)}"
        )
        raw = await adapter.complete(SYSTEM_PROMPT, user_msg)
        return {**state, "raw_output": raw}

    def _parse_output(state: CompletenessState) -> CompletenessState:
        inp = state["inp"]
        try:
            parsed = json.loads(state["raw_output"])
            confidence = float(parsed.get("confidence", 0.0))
            citations = list(parsed.get("citations", []))
            abstained = confidence < 0.4
            output = AgentOutput(
                agent_id="completeness-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=confidence,
                citations=citations,
                abstained=abstained,
                abstention_reason="low confidence" if abstained else None,
                result=parsed if not abstained else None,
                provenance={
                    "model_name": adapter.model_name(),
                    "input_hash": hashlib.sha256(
                        json.dumps(inp.case_summary, sort_keys=True).encode()
                    ).hexdigest(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "completeness_agent: parse error, abstaining — model=%s error=%r",
                adapter.model_name(),
                str(exc)[:200],
            )
            # covers json.JSONDecodeError, TypeError, ValueError from confidence parsing
            output = AgentOutput(
                agent_id="completeness-v1",
                tenant_id=inp.tenant_id,
                case_id=inp.case_id,
                confidence=0.0,
                citations=[],
                abstained=True,
                abstention_reason=f"parse_error: {exc}",
                result=None,
                provenance={
                    "model_name": adapter.model_name(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        return {**state, "agent_output": output}

    def _run_guardrails(state: CompletenessState) -> CompletenessState:
        engine = GuardrailEngine()
        result = engine.check(state["agent_output"], state["inp"].tenant_id)
        return {**state, "guardrail_result": result}

    g = StateGraph(CompletenessState)
    g.add_node("call_model", _call_model)
    g.add_node("parse_output", _parse_output)
    g.add_node("run_guardrails", _run_guardrails)
    g.set_entry_point("call_model")
    g.add_edge("call_model", "parse_output")
    g.add_edge("parse_output", "run_guardrails")
    g.add_edge("run_guardrails", END)
    return g.compile()

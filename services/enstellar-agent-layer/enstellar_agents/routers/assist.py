"""FastAPI router for agent-assist endpoints.

POST /assist/completeness — Completeness & RFI assist agent.

This endpoint is advisory only. It NEVER writes to the workflow-engine.
All agent outputs pass through GuardrailEngine before being returned.
If the guardrail blocks the output, the response has abstained=True and result=None.
"""
from __future__ import annotations

from fastapi import APIRouter

from enstellar_agents.agents.completeness import build_graph
from enstellar_agents.agents.triage import build_triage_graph
from enstellar_agents.config import get_settings
from enstellar_agents.model_access.factory import get_adapter
from enstellar_agents.models import AgentInput, AgentOutput, GuardrailResult

router = APIRouter()


@router.post("/assist/completeness")
async def completeness_assist(body: AgentInput) -> AgentOutput:
    """Run the CompletenessAgent and return a guardrail-checked AgentOutput.

    The caller (BFF or workflow-engine) must treat the response as advisory.
    If ``abstained=True``, the agent could not produce a usable recommendation.
    The caller must not use ``result`` to make a coverage determination.
    """
    adapter = get_adapter(get_settings())
    graph = build_graph(adapter)
    final = await graph.ainvoke(
        {"inp": body, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    gr: GuardrailResult | None = final.get("guardrail_result")
    output: AgentOutput = final["agent_output"]

    if gr is None or not gr.passed:
        # Guardrail did not run or fired — scrub the result and surface reasons.
        violations = gr.violations if gr is not None else ["guardrail_did_not_run"]
        output = output.model_copy(
            update={
                "abstained": True,
                "abstention_reason": "; ".join(violations),
                "result": None,
            }
        )
    return output


@router.post("/assist/triage")
async def triage_assist(body: AgentInput) -> AgentOutput:
    """Run the TriageAgent and return a guardrail-checked AgentOutput.

    Advisory only — the suggested_queue is a routing recommendation, not a commitment.
    If abstained=True, the agent could not produce a usable recommendation.
    """
    adapter = get_adapter(get_settings())
    graph = build_triage_graph(adapter)
    final = await graph.ainvoke(
        {"inp": body, "raw_output": "", "agent_output": None, "guardrail_result": None}
    )
    gr: GuardrailResult | None = final.get("guardrail_result")
    output: AgentOutput = final["agent_output"]

    if gr is None or not gr.passed:
        # Guardrail did not run or fired — scrub the result and surface the violation reasons.
        violations = gr.violations if gr is not None else ["guardrail_did_not_run"]
        output = output.model_copy(
            update={
                "abstained": True,
                "abstention_reason": "; ".join(violations),
                "result": None,
            }
        )
    return output

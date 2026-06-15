"""Individual guardrail rule functions.

Each rule takes an AgentOutput (and optional extra args) and returns:
  - None   → rule passed
  - str    → rule failed; the string is a human-readable violation message

Rules are called by GuardrailEngine.check(); do not call them directly in
application code.

INVARIANT RULES (never weaken or remove):
  - rule_no_autonomous_adverse
  - rule_tenant_isolation
  - rule_phi_minimization
"""
from __future__ import annotations

import re

from enstellar_agents.models import AgentOutput

ADVERSE_KEYWORDS: frozenset[str] = frozenset(
    [
        "denied",
        "deny",
        "denial",
        "adverse",
        "not medically necessary",
        "experimental",
        "investigational",
    ]
)

_DOB_KEYWORDS: frozenset[str] = frozenset(
    ["dob", "date of birth", "birthdate", "born"]
)


def _extract_all_text(output: AgentOutput) -> str:
    """Return all user-controlled text from an AgentOutput as a single lowercase string."""
    parts = [
        str(output.result or ""),
        output.abstention_reason or "",
        " ".join(output.citations),
    ]
    return " ".join(parts).lower()


def rule_no_autonomous_adverse(output: AgentOutput) -> str | None:
    """INVARIANT: Agent output must never contain adverse-determination language.

    Any match blocks the output regardless of other fields.
    Scans all text-bearing fields: result, abstention_reason, citations.
    """
    text = _extract_all_text(output)
    for kw in ADVERSE_KEYWORDS:
        if kw in text:
            return f"no_autonomous_adverse: found '{kw}' in output"
    return None


def rule_citations_required(output: AgentOutput) -> str | None:
    """Non-abstained output must cite at least one source."""
    if not output.abstained and not output.citations:
        return "citations_required: non-abstained output has no citations"
    return None


def rule_confidence_threshold(output: AgentOutput, threshold: float = 0.7) -> str | None:
    """Non-abstained output must meet the minimum confidence threshold."""
    if not output.abstained and output.confidence < threshold:
        return f"confidence_threshold: {output.confidence:.2f} < {threshold}"
    return None


def rule_schema_validity(output: AgentOutput) -> str | None:
    """Output must be re-parseable from its own serialization."""
    try:
        AgentOutput.model_validate(output.model_dump())
        return None
    except Exception as exc:
        return f"schema_validity: {exc}"


def rule_tenant_isolation(output: AgentOutput, expected_tenant_id: str) -> str | None:
    """INVARIANT: Output tenant_id must match the request tenant_id (no cross-tenant leakage)."""
    if output.tenant_id.strip() != expected_tenant_id.strip():
        return "tenant_isolation: output tenant_id mismatch"
    return None


def rule_phi_minimization(output: AgentOutput) -> str | None:
    """INVARIANT: Heuristic check — reject output containing SSN or DOB patterns.

    Scans all text-bearing fields: result, abstention_reason, citations.
    """
    text = _extract_all_text(output)
    if re.search(r"\b\d{3}-\d{2}-\d{4}\b", text):
        return "phi_minimization: SSN-like pattern in output"
    if re.search(r"\b\d{4}-\d{2}-\d{2}\b", text) and any(
        kw in text for kw in _DOB_KEYWORDS
    ):
        return "phi_minimization: probable DOB in output"
    return None


def rule_abstention_on_low_confidence(output: AgentOutput, threshold: float = 0.4) -> str | None:
    """Output with confidence below the abstention threshold must have abstained=True."""
    if output.confidence < threshold and not output.abstained:
        return (
            f"abstention_required: confidence {output.confidence:.2f} < {threshold},"
            " output must set abstained=True"
        )
    return None

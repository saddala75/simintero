"""Tests for ClinicalReviewConsumer.

This consumer no longer calls the agent-layer. On a clinical_review transition it:
  1. Resolves the case's document_refs from the Document Service (by case_ref).
  2. Submits a C-2 analysis (completeness + triage) to the real Revital pipeline.
  3. Records a revital_inflight row (a background poller picks up the result).

Invariants verified:
  #2  No LLM on the decision path — Revital output is advisory only.
  #3  PHI-minimum: member name, DOB, MRN must NOT appear in the case_context.
  #4  tenant_id on every submit + row.
  Never-block: a Revital/doc failure emits AGENT_ASSIST_FAILED and returns —
      the case is never blocked, and no inflight row is written.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import asyncpg
import pytest

from canonical_model import Case, Status
from simintero_outbox import SchemaRef, make_envelope

from enstellar_connectors.revital.models import RevitalUnavailableError

from enstellar_workflow.cases.repository import CaseRepository
from enstellar_workflow.consumers.clinical_review_consumer import (
    ClinicalReviewConsumer,
    _build_agent_input,
)
from tests.conftest import make_case


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_clinical_review_event(case: Case):
    """Build a CASE_STATE_CHANGED event with to_state=clinical_review.

    The event's correlation_id is a PER-TRANSITION value, deliberately DISTINCT
    from the case's stable business correlation_id. The consumer must use
    case.correlation_id (not event.correlation_id) for the Revital/doc/inflight
    path — documents were ingested under the case's stable id.
    """
    return make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id=case.tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=f"{case.correlation_id}-to-clinical",
        payload={
            "case_id": str(case.case_id),
            "from_state": "auto_determination",
            "to_state": "clinical_review",
        },
    )


def _stub_collaborators(
    consumer: ClinicalReviewConsumer,
    *,
    refs: list[str] | None = None,
    analysis_id: str = "an-123",
    submit_exc: Exception | None = None,
    resolve_exc: Exception | None = None,
    exists: bool = False,
):
    """Replace _docs, _revital, _inflight, _outbox with AsyncMocks.

    Returns the (docs, revital, inflight, outbox) mocks for assertions.
    """
    docs = AsyncMock()
    if resolve_exc is not None:
        docs.resolve_refs.side_effect = resolve_exc
    else:
        docs.resolve_refs.return_value = refs if refs is not None else ["doc-1", "doc-2"]

    revital = AsyncMock()
    if submit_exc is not None:
        revital.submit.side_effect = submit_exc
    else:
        revital.submit.return_value = analysis_id

    inflight = AsyncMock()
    inflight.exists_processing_for_case.return_value = exists
    inflight.insert.return_value = None

    outbox = AsyncMock()

    consumer._docs = docs
    consumer._revital = revital
    consumer._inflight = inflight
    consumer._outbox = outbox
    return docs, revital, inflight, outbox


# ---------------------------------------------------------------------------
# Unit test — PHI invariant (no DB required)
# ---------------------------------------------------------------------------

def test_phi_not_in_agent_input():
    """INVARIANT #3: member name, DOB, MRN must not appear in case_summary."""
    case = make_case()
    agent_input = _build_agent_input(case, case.correlation_id)

    summary_str = json.dumps(agent_input["case_summary"])

    assert case.member.first_name not in summary_str
    assert case.member.last_name not in summary_str
    assert str(case.member.date_of_birth) not in summary_str
    if case.member.mrn is not None:
        assert case.member.mrn not in summary_str

    assert "procedure_codes" in agent_input["case_summary"]
    assert "99213" in agent_input["case_summary"]["procedure_codes"]
    assert "urgency" in agent_input["case_summary"]
    assert "lob" in agent_input["case_summary"]

    assert agent_input["tenant_id"] == case.tenant_id
    assert agent_input["case_id"] == str(case.case_id)


# ---------------------------------------------------------------------------
# Integration tests — require pg_pool (for tenant_transaction)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_non_clinical_review_transition_is_ignored(pg_pool: asyncpg.Pool):
    """Events with to_state != 'clinical_review' must be ignored — no submit/insert."""
    consumer = ClinicalReviewConsumer(pg_pool)
    docs, revital, inflight, _ = _stub_collaborators(consumer)
    case = make_case()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    event = make_envelope(
        SchemaRef.CASE_STATE_CHANGED,
        tenant_id=case.tenant_id,
        actor_id="system",
        actor_type="system",
        correlation_id=case.correlation_id,
        payload={
            "case_id": str(case.case_id),
            "from_state": "intake",
            "to_state": "md_review",
        },
    )

    await consumer.handle(event)

    docs.resolve_refs.assert_not_called()
    revital.submit.assert_not_called()
    inflight.insert.assert_not_called()


@pytest.mark.asyncio
async def test_submits_to_revital_and_records_inflight(pg_pool: asyncpg.Pool):
    """On clinical_review: resolve refs → submit to Revital → record inflight.

    The CASE's stable correlation_id (under which I2a ingested documents) must be
    used for resolve_refs / submit / inflight — NOT the event's per-transition id.
    """
    case = make_case(status=Status.clinical_review, correlation_id="corr-stable")

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    consumer = ClinicalReviewConsumer(pg_pool)
    docs, revital, inflight, _ = _stub_collaborators(
        consumer, refs=["doc-a", "doc-b"], analysis_id="an-999"
    )

    event = _make_clinical_review_event(case)
    # Guard the premise: the event carries a DIFFERENT (per-transition) id.
    assert event.correlation_id == "corr-stable-to-clinical"
    assert event.correlation_id != case.correlation_id

    await consumer.handle(event)

    # 1. resolve_refs called with case_ref=CASE correlation_id (not the event's)
    docs.resolve_refs.assert_awaited_once_with(
        case_ref="corr-stable", tenant_id=case.tenant_id
    )
    assert docs.resolve_refs.await_args.kwargs["case_ref"] != event.correlation_id

    # 2. submit called with completeness+triage, resolved refs, PHI-min context, tenant
    revital.submit.assert_awaited_once()
    kwargs = revital.submit.await_args.kwargs
    assert kwargs["case_ref"] == "corr-stable"
    assert kwargs["case_ref"] != event.correlation_id
    assert kwargs["analysis_kinds"] == ["completeness", "triage"]
    assert kwargs["document_refs"] == ["doc-a", "doc-b"]
    assert kwargs["tenant_id"] == case.tenant_id

    ctx = kwargs["case_context"]
    # PHI-min context — codes/urgency/lob, no member PHI
    assert ctx["procedure_codes"] == ["99213"]
    assert ctx["urgency"] == case.urgency.value
    assert ctx["lob"] == case.lob
    ctx_str = json.dumps(ctx)
    assert case.member.first_name not in ctx_str
    assert case.member.last_name not in ctx_str
    assert str(case.member.date_of_birth) not in ctx_str

    # 3. inflight insert with the returned analysis_id
    inflight.insert.assert_awaited_once()
    ins_kwargs = inflight.insert.await_args.kwargs
    assert ins_kwargs["analysis_id"] == "an-999"
    assert ins_kwargs["case_id"] == case.case_id
    assert ins_kwargs["tenant_id"] == case.tenant_id
    assert ins_kwargs["correlation_id"] == "corr-stable"
    assert ins_kwargs["correlation_id"] != event.correlation_id


@pytest.mark.asyncio
async def test_no_agent_layer_http_call(pg_pool: asyncpg.Pool):
    """The consumer must make NO agent-layer HTTP POST (agent-layer is dropped)."""
    case = make_case(status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    consumer = ClinicalReviewConsumer(pg_pool)
    _stub_collaborators(consumer)
    event = _make_clinical_review_event(case)

    # The old code used httpx.AsyncClient in this module to POST to the agent-layer.
    # Guard: if any such client is constructed, fail.
    import enstellar_workflow.consumers.clinical_review_consumer as mod

    if hasattr(mod, "httpx"):
        with patch.object(mod.httpx, "AsyncClient") as ac:
            await consumer.handle(event)
        ac.assert_not_called()
    else:  # pragma: no cover - httpx still imported for HTTPError typing
        await consumer.handle(event)


@pytest.mark.asyncio
async def test_revital_unavailable_emits_failed_no_inflight(pg_pool: asyncpg.Pool):
    """submit raising RevitalUnavailableError → AGENT_ASSIST_FAILED, no inflight insert."""
    case = make_case(status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    consumer = ClinicalReviewConsumer(pg_pool)
    docs, revital, inflight, outbox = _stub_collaborators(
        consumer, submit_exc=RevitalUnavailableError("revital down")
    )
    event = _make_clinical_review_event(case)

    # Must not raise — never-block invariant
    await consumer.handle(event)

    revital.submit.assert_awaited_once()
    inflight.insert.assert_not_called()

    # An AGENT_ASSIST_FAILED event was published
    outbox.publish.assert_awaited()
    published = outbox.publish.await_args.args[1]
    assert published.schema_ref == SchemaRef.AGENT_ASSIST_FAILED


@pytest.mark.asyncio
async def test_duplicate_inflight_skips_submit(pg_pool: asyncpg.Pool):
    """exists_processing_for_case True → no second submit, no insert."""
    case = make_case(status=Status.clinical_review)

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await CaseRepository().insert(conn, case)

    consumer = ClinicalReviewConsumer(pg_pool)
    docs, revital, inflight, _ = _stub_collaborators(consumer, exists=True)
    event = _make_clinical_review_event(case)

    await consumer.handle(event)

    inflight.exists_processing_for_case.assert_awaited_once()
    docs.resolve_refs.assert_not_called()
    revital.submit.assert_not_called()
    inflight.insert.assert_not_called()

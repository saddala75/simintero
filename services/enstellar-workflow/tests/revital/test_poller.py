"""Tests for RevitalPoller._process_one — the per-row terminal/timeout/transient logic.

These use fakes for the RevitalClient, the repos, the OutboxPublisher, the
CaseRepository, and tenant_transaction so the orchestration is verified without
a live DB or HTTP server. (The cross-tenant scan + role-switch structure mirrors
OutboxRelay, which is covered by its own live test_relay.py.)
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest

from canonical_model import EventEnvelope
from enstellar_connectors.revital.models import (
    AnalysisResult,
    CompletenessBlock,
    Gap,
    RevitalUnavailableError,
    TriageBlock,
)

from enstellar_workflow.revital.poller import RevitalPoller


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class FakeRevital:
    def __init__(self, result=None, exc=None):
        self._result = result
        self._exc = exc
        self.calls = []

    async def get_analysis(self, analysis_id, tenant_id):
        self.calls.append((analysis_id, tenant_id))
        if self._exc is not None:
            raise self._exc
        return self._result


class FakeRepo:
    def __init__(self):
        self.inserted = []

    async def insert_many(self, conn, rows):
        self.inserted.append(rows)


class FakeInflight:
    def __init__(self):
        self.done = []

    async def mark_done(self, conn, analysis_id):
        self.done.append(analysis_id)


class FakeOutbox:
    def __init__(self):
        self.published = []

    async def publish(self, conn, event):
        self.published.append(event)


class FakeCase:
    def __init__(self):
        self.lob = "commercial"


class FakeCaseRepo:
    async def fetch_by_id(self, conn, case_id, tenant_id):
        return FakeCase()


@asynccontextmanager
async def fake_tenant_transaction(pool, tenant_id):
    yield object()  # a dummy "conn"


def _row(submitted_at=None):
    return {
        "analysis_id": "an-1",
        "case_id": uuid.uuid4(),
        "tenant_id": "tenant-poll",
        "correlation_id": "corr-1",
        "submitted_at": submitted_at or datetime.now(timezone.utc),
    }


def _make_poller(monkeypatch, revital):
    monkeypatch.setattr(
        "enstellar_workflow.revital.poller.tenant_transaction",
        fake_tenant_transaction,
    )
    poller = RevitalPoller(pool=object(), revital=revital)
    poller._criteria = FakeRepo()
    poller._suggestions = FakeRepo()
    poller._inflight = FakeInflight()
    poller._outbox = FakeOutbox()
    poller._cases = FakeCaseRepo()
    return poller


# ---------------------------------------------------------------------------
# complete → criteria + suggestion + AGENT_ASSIST_PRODUCED + mark_done
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_complete_writes_rows_event_and_marks_done(monkeypatch):
    result = AnalysisResult(
        analysis_id="an-1",
        status="complete",
        completeness=CompletenessBlock(
            status="ok",
            gaps=[Gap(requirement_id="REQ-1", description="missing labs")],
        ),
        triage=TriageBlock(status="ok", suggestion="likely_meets", confidence=0.9),
    )
    poller = _make_poller(monkeypatch, FakeRevital(result=result))
    row = _row()

    await poller._process_one(row)

    assert len(poller._criteria.inserted) == 1
    assert poller._criteria.inserted[0][0]["criterion_id"] == "REQ-1"
    assert len(poller._suggestions.inserted) == 1
    assert poller._suggestions.inserted[0][0]["agent_id"] == "revital"
    assert len(poller._outbox.published) == 1
    event = poller._outbox.published[0]
    assert isinstance(event, EventEnvelope)
    assert event.schema_ref.endswith("AgentAssistProduced/v1")
    assert event.payload["case_id"] == str(row["case_id"])
    assert poller._inflight.done == ["an-1"]


@pytest.mark.asyncio
async def test_partial_is_treated_as_terminal_ok(monkeypatch):
    result = AnalysisResult(analysis_id="an-1", status="partial")
    poller = _make_poller(monkeypatch, FakeRevital(result=result))
    row = _row()

    await poller._process_one(row)

    # No gaps/triage → no rows, but the produced event still fires and row done.
    assert poller._criteria.inserted == []
    assert poller._suggestions.inserted == []
    assert len(poller._outbox.published) == 1
    assert poller._outbox.published[0].schema_ref.endswith("AgentAssistProduced/v1")
    assert poller._inflight.done == ["an-1"]


# ---------------------------------------------------------------------------
# failed → AGENT_ASSIST_FAILED + no rows + mark_done
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_failed_emits_failed_event_no_rows(monkeypatch):
    result = AnalysisResult(analysis_id="an-1", status="failed")
    poller = _make_poller(monkeypatch, FakeRevital(result=result))
    row = _row()

    await poller._process_one(row)

    assert poller._criteria.inserted == []
    assert poller._suggestions.inserted == []
    assert len(poller._outbox.published) == 1
    event = poller._outbox.published[0]
    assert event.schema_ref.endswith("AgentAssistFailed/v1")
    assert event.payload["reason"] == "revital_status_failed"
    assert poller._inflight.done == ["an-1"]


# ---------------------------------------------------------------------------
# processing + timed out → AGENT_ASSIST_FAILED (timeout) + mark_done
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_processing_past_timeout_fails_with_timeout(monkeypatch):
    result = AnalysisResult(analysis_id="an-1", status="processing")
    poller = _make_poller(monkeypatch, FakeRevital(result=result))
    old = datetime.now(timezone.utc) - timedelta(seconds=10_000)
    row = _row(submitted_at=old)

    await poller._process_one(row)

    assert len(poller._outbox.published) == 1
    event = poller._outbox.published[0]
    assert event.schema_ref.endswith("AgentAssistFailed/v1")
    assert event.payload["reason"] == "timeout"
    assert poller._inflight.done == ["an-1"]


# ---------------------------------------------------------------------------
# processing within timeout → nothing written, NOT marked done
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_processing_within_timeout_does_nothing(monkeypatch):
    result = AnalysisResult(analysis_id="an-1", status="processing")
    poller = _make_poller(monkeypatch, FakeRevital(result=result))
    row = _row()  # submitted just now

    await poller._process_one(row)

    assert poller._criteria.inserted == []
    assert poller._suggestions.inserted == []
    assert poller._outbox.published == []
    assert poller._inflight.done == []


# ---------------------------------------------------------------------------
# transient error → row left processing, _process_one does NOT raise
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_revital_unavailable_leaves_row_processing(monkeypatch):
    poller = _make_poller(
        monkeypatch, FakeRevital(exc=RevitalUnavailableError("down"))
    )
    row = _row()

    await poller._process_one(row)  # must not raise

    assert poller._criteria.inserted == []
    assert poller._suggestions.inserted == []
    assert poller._outbox.published == []
    assert poller._inflight.done == []


@pytest.mark.asyncio
async def test_unexpected_exception_does_not_raise(monkeypatch):
    poller = _make_poller(monkeypatch, FakeRevital(exc=ValueError("boom")))
    row = _row()

    await poller._process_one(row)  # must not raise

    assert poller._inflight.done == []

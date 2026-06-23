"""Task 3 — normalize writes case evidence to fabric BEFORE auto_determination.

Drives the ``normalize`` handler directly with fakes (no DB / no MinIO real I/O):
a fake ``request`` carrying ``app.state.fabric_pool``, a fake ``CaseService``
that records create_case + transition, and the MinIO upload / write_case_evidence
patched. Asserts:

  * the fabric write is invoked with (bundle, case stable member_ref, tenant, raw_key);
  * it runs BEFORE the auto_determination transition (shared call-order log);
  * best-effort: a write_case_evidence exception does NOT break normalize.
"""
from __future__ import annotations

import pathlib
import json
from types import SimpleNamespace

import pytest

from canonical_model import Status
from enstellar_workflow.normalization import api as normalize_api
from enstellar_workflow.normalization.api import NormalizeRequest, normalize

FIXTURES = pathlib.Path(__file__).parent / "fixtures"


@pytest.fixture
def sample_bundle() -> dict:
    return json.loads((FIXTURES / "sample_pas_bundle.json").read_text())


class _FakeCaseService:
    """Records create_case + transition; returns the case the mapper produced."""

    def __init__(self, calls: list[str]) -> None:
        self._calls = calls
        self.created_case = None

    async def create_case(self, case):
        self.created_case = case
        return case

    async def transition(self, req):
        self._calls.append("transition")
        return self.created_case


def _fake_request(fabric_pool):
    app = SimpleNamespace(state=SimpleNamespace(fabric_pool=fabric_pool))
    return SimpleNamespace(app=app)


@pytest.mark.asyncio
async def test_fabric_write_runs_before_transition(monkeypatch, sample_bundle):
    calls: list[str] = []
    captured: dict = {}

    # Patch MinIO upload so no real object store is hit.
    monkeypatch.setattr(
        normalize_api.MinioStore, "upload",
        lambda self, tenant, corr, bundle: "tenant-acme/raw-bundles/2026/corr.json",
    )

    async def fake_write(fabric_pool, tenant_id, member_logical_id, raw_key, bundle):
        calls.append("fabric_write")
        captured.update(
            fabric_pool=fabric_pool, tenant_id=tenant_id,
            member_logical_id=member_logical_id, raw_key=raw_key, bundle=bundle,
        )
        return 3

    monkeypatch.setattr(normalize_api, "write_case_evidence", fake_write)

    fabric_pool = object()
    svc = _FakeCaseService(calls)
    req = NormalizeRequest(bundle=sample_bundle, tenant_id="tenant-acme", correlation_id="corr-xyz")

    result = await normalize(req, request=_fake_request(fabric_pool), case_service=svc)

    # Case was created + (since status==intake) transitioned to auto_determination.
    assert svc.created_case is not None
    assert result["_raw_bundle_key"] == "tenant-acme/raw-bundles/2026/corr.json"

    # Ordering: the fabric write happened, and BEFORE the transition.
    assert calls == ["fabric_write", "transition"], calls

    # The write got the right args.
    assert captured["fabric_pool"] is fabric_pool
    assert captured["tenant_id"] == "tenant-acme"
    assert captured["raw_key"] == "tenant-acme/raw-bundles/2026/corr.json"
    assert captured["bundle"] == sample_bundle
    # member_logical_id == the case's stable member ref (bundle Patient logical id).
    from enstellar_workflow.engine.auto_determination import _stable_member_ref
    assert captured["member_logical_id"] == _stable_member_ref(svc.created_case)
    assert captured["member_logical_id"]  # non-empty


@pytest.mark.asyncio
async def test_fabric_write_failure_is_best_effort(monkeypatch, sample_bundle):
    """A write_case_evidence exception must NOT break normalize; the case still
    transitions to auto_determination."""
    calls: list[str] = []

    monkeypatch.setattr(
        normalize_api.MinioStore, "upload",
        lambda self, tenant, corr, bundle: "raw-key",
    )

    async def boom(*args, **kwargs):
        calls.append("fabric_write")
        raise RuntimeError("fabric down")

    monkeypatch.setattr(normalize_api, "write_case_evidence", boom)

    svc = _FakeCaseService(calls)
    req = NormalizeRequest(bundle=sample_bundle, tenant_id="tenant-acme", correlation_id="corr-1")

    # Must NOT raise.
    result = await normalize(req, request=_fake_request(object()), case_service=svc)

    assert svc.created_case is not None
    assert svc.created_case.status == Status.intake  # mapper output unchanged
    # The fabric write was attempted, swallowed, and the transition still ran AFTER.
    assert calls == ["fabric_write", "transition"], calls
    assert result["_raw_bundle_key"] == "raw-key"

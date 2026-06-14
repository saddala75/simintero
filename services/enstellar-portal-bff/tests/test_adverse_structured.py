"""BFF contract tests: structured adverse payload forwarding."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport

from enstellar_bff.auth import require_reviewer
from enstellar_bff.main import app

CASE_ID = "00000000-0000-0000-0000-000000000001"
AUTH = {"sub": "reviewer-001", "tenant_id": "tenant-a"}


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[require_reviewer] = lambda: AUTH
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_structured_fields_forwarded_to_workflow_engine():
    """All four structured fields appear in the payload passed to workflow_client.transition()."""
    with patch("enstellar_bff.routers.cases.workflow_client") as mock_wf:
        mock_wf.record_signoff = AsyncMock(return_value={})
        mock_wf.transition = AsyncMock(
            return_value={"case_id": CASE_ID, "status": "denied"}
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "Not medically necessary",
                    "clinician_id": "dr-001",
                    "sign_off_confirmed": True,
                    "finding_sections": [
                        {
                            "criterion_id": "C-02",
                            "text": "Missing attestation",
                            "status": "gap",
                        }
                    ],
                    "reason_codes": ["M54.5"],
                    "citations": ["InterQual 2025 §3.4.1"],
                },
            )

        assert resp.status_code == 200
        payload = mock_wf.transition.call_args.kwargs["payload"]
        assert payload["determination_type"] == "denied"
        assert payload["finding_sections"] == [
            {"criterion_id": "C-02", "text": "Missing attestation", "status": "gap"}
        ]
        assert payload["reason_codes"] == ["M54.5"]
        assert payload["citations"] == ["InterQual 2025 §3.4.1"]
        assert payload["reason"] == "Not medically necessary"
        # actor_id MUST come from auth["sub"], never from request body
        assert mock_wf.transition.call_args.kwargs["actor_id"] == AUTH["sub"]


@pytest.mark.asyncio
async def test_legacy_call_without_structured_fields_still_returns_200():
    """Backwards compat: omitting new fields returns 200; payload contains only reason."""
    with patch("enstellar_bff.routers.cases.workflow_client") as mock_wf:
        mock_wf.record_signoff = AsyncMock(return_value={})
        mock_wf.transition = AsyncMock(
            return_value={"case_id": CASE_ID, "status": "denied"}
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "Not medically necessary",
                    "clinician_id": "dr-001",
                    "sign_off_confirmed": True,
                },
            )

        assert resp.status_code == 200
        payload = mock_wf.transition.call_args.kwargs["payload"]
        assert payload == {"reason": "Not medically necessary", "determination_type": "denied"}
        # No new keys when fields are omitted
        assert "finding_sections" not in payload


@pytest.mark.asyncio
async def test_sign_off_false_still_returns_400_with_structured_fields():
    """Existing invariant: sign_off_confirmed=False → 400, even when structured fields present.

    No upstream calls must be made — the guard must fire before any signoff/transition.
    """
    with patch("enstellar_bff.routers.cases.workflow_client") as mock_wf:
        mock_wf.record_signoff = AsyncMock(return_value={})
        mock_wf.transition = AsyncMock(return_value={})

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/bff/cases/{CASE_ID}/adverse-decision",
                json={
                    "outcome": "denied",
                    "reason": "test",
                    "clinician_id": "dr-001",
                    "sign_off_confirmed": False,
                    "determination_type": "denied",
                    "reason_codes": ["M54.5"],
                },
            )

        assert resp.status_code == 400
        mock_wf.record_signoff.assert_not_called()
        mock_wf.transition.assert_not_called()

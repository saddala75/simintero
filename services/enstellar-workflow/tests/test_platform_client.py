"""Unit tests for PlatformCaseClient."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from enstellar_workflow.engine.platform_client import PlatformCaseClient
from enstellar_workflow.engine.transitions import TransitionRequest


def _make_req(**overrides) -> TransitionRequest:
    defaults = dict(
        case_id=uuid.uuid4(),
        tenant_id="tenant-001",
        to_state="completeness_check",
        actor_id="system",
        actor_type="system",
        correlation_id="corr-001",
        human_signoff_recorded=False,
    )
    defaults.update(overrides)
    return TransitionRequest(**defaults)


def _make_mock_http(status_code: int = 200, raise_on_raise_for_status: Exception | None = None):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    if raise_on_raise_for_status:
        mock_resp.raise_for_status.side_effect = raise_on_raise_for_status
    else:
        mock_resp.raise_for_status.return_value = None

    mock_http = AsyncMock()
    mock_http.post = AsyncMock(return_value=mock_resp)
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)
    return mock_http


@pytest.mark.asyncio
async def test_post_transition_calls_platform():
    """Successful 200 response — no exception raised."""
    client = PlatformCaseClient(base_url="http://case-service:8091")
    mock_http = _make_mock_http(200)

    with patch("enstellar_workflow.engine.platform_client.httpx.AsyncClient", return_value=mock_http):
        await client.post_transition(
            req=_make_req(),
            from_state="intake",
            event_id=uuid.uuid4(),
        )

    mock_http.post.assert_called_once()
    call_kwargs = mock_http.post.call_args
    assert "/internal/transitions/notify" in call_kwargs.args[0]


@pytest.mark.asyncio
async def test_post_transition_includes_human_signoff():
    """human_signoff_recorded=True is forwarded in payload."""
    client = PlatformCaseClient(base_url="http://case-service:8091")
    captured_json: dict = {}
    mock_resp = MagicMock(status_code=200)
    mock_resp.raise_for_status.return_value = None

    async def fake_post(url, *, json, headers, timeout):
        captured_json.update(json)
        return mock_resp

    mock_http = AsyncMock()
    mock_http.post = fake_post
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)

    with patch("enstellar_workflow.engine.platform_client.httpx.AsyncClient", return_value=mock_http):
        await client.post_transition(
            req=_make_req(to_state="denied", human_signoff_recorded=True),
            from_state="clinical_review",
            event_id=uuid.uuid4(),
        )

    payload = captured_json.get("payload", {})
    assert payload.get("human_signoff_recorded") is True
    assert payload.get("to") == "denied"
    assert payload.get("from") == "clinical_review"
    assert captured_json.get("tenant") == {"tenant_id": "tenant-001"}


@pytest.mark.asyncio
async def test_post_transition_raises_on_4xx():
    """4xx from platform propagates — caller decides whether to swallow."""
    client = PlatformCaseClient(base_url="http://case-service:8091")
    error = httpx.HTTPStatusError("403", request=MagicMock(), response=MagicMock(status_code=403))
    mock_http = _make_mock_http(403, raise_on_raise_for_status=error)

    with patch("enstellar_workflow.engine.platform_client.httpx.AsyncClient", return_value=mock_http):
        with pytest.raises(httpx.HTTPStatusError):
            await client.post_transition(
                req=_make_req(),
                from_state="intake",
                event_id=uuid.uuid4(),
            )

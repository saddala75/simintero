"""Tests for ModelAdapter ABC, OllamaAdapter (respx mock), AnthropicAdapter, and factory."""
from __future__ import annotations

import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock, patch


# ──────────────────────────────────────────────
# OllamaAdapter
# ──────────────────────────────────────────────

@respx.mock
async def test_ollama_adapter_complete_success() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    respx.post("http://test-ollama:11434/api/generate").mock(
        return_value=httpx.Response(200, json={"response": "Gap analysis result here."})
    )
    adapter = OllamaAdapter(base_url="http://test-ollama:11434", model="llama3")
    result = await adapter.complete("system prompt", "user message")
    assert result == "Gap analysis result here."


@respx.mock
async def test_ollama_adapter_raises_on_http_error() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    respx.post("http://test-ollama:11434/api/generate").mock(
        return_value=httpx.Response(500, text="Internal Server Error")
    )
    adapter = OllamaAdapter(base_url="http://test-ollama:11434", model="llama3")
    with pytest.raises(httpx.HTTPStatusError):
        await adapter.complete("system", "user message")


def test_ollama_adapter_model_name() -> None:
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    adapter = OllamaAdapter(base_url="http://ollama:11434", model="llama3")
    assert adapter.model_name() == "llama3"


# ──────────────────────────────────────────────
# factory
# ──────────────────────────────────────────────

def test_factory_returns_ollama_adapter(monkeypatch) -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter
    from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

    monkeypatch.setenv("ENSTELLAR_MODEL_PROVIDER", "ollama")
    monkeypatch.setenv("ENSTELLAR_MODEL_NAME", "llama3")
    settings = AgentSettings()
    adapter = get_adapter(settings)
    assert isinstance(adapter, OllamaAdapter)
    assert adapter.model_name() == "llama3"


def test_factory_raises_on_unknown_provider() -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.factory import get_adapter

    # model_construct bypasses validators so we can inject "unknown"
    settings = AgentSettings.model_construct(
        model_provider="unknown",
        model_name="test",
        anthropic_api_key=None,
        ollama_base_url="http://localhost:11434",
    )
    with pytest.raises(ValueError, match="Unknown model_provider"):
        get_adapter(settings)


# ──────────────────────────────────────────────
# AnthropicAdapter
# ──────────────────────────────────────────────

async def test_anthropic_adapter_complete_success() -> None:
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

    # Build the mock return value — AsyncAnthropic.messages.create returns a Message
    mock_text_block = MagicMock()
    mock_text_block.text = "Here are the identified documentation gaps."
    mock_message = MagicMock()
    mock_message.content = [mock_text_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)

    with patch(
        "enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic",
        return_value=mock_client,
    ):
        adapter = AnthropicAdapter(api_key="test-key-001", model="claude-opus-4-8")
        result = await adapter.complete("system prompt", "user message")

    assert result == "Here are the identified documentation gaps."
    mock_client.messages.create.assert_called_once_with(
        model="claude-opus-4-8",
        max_tokens=2048,
        system="system prompt",
        messages=[{"role": "user", "content": "user message"}],
    )


def test_anthropic_adapter_model_name() -> None:
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

    with patch("enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic"):
        adapter = AnthropicAdapter(api_key="test-key-001", model="claude-opus-4-8")
    assert adapter.model_name() == "claude-opus-4-8"


def test_factory_returns_anthropic_adapter(monkeypatch) -> None:
    from enstellar_agents.config import AgentSettings
    from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter
    from enstellar_agents.model_access.factory import get_adapter

    monkeypatch.setenv("ENSTELLAR_MODEL_PROVIDER", "anthropic")
    monkeypatch.setenv("ENSTELLAR_MODEL_NAME", "claude-opus-4-8")
    monkeypatch.setenv("ENSTELLAR_ANTHROPIC_API_KEY", "test-key-001")

    with patch("enstellar_agents.model_access.anthropic_adapter.anthropic.AsyncAnthropic"):
        settings = AgentSettings()
        adapter = get_adapter(settings)

    assert isinstance(adapter, AnthropicAdapter)
    assert adapter.model_name() == "claude-opus-4-8"

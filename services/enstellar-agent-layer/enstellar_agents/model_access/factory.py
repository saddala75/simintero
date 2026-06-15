"""Factory function to select the correct ModelAdapter from settings."""
from __future__ import annotations

from enstellar_agents.config import AgentSettings
from enstellar_agents.model_access.base import ModelAdapter


def get_adapter(settings: AgentSettings) -> ModelAdapter:
    """Return the configured ModelAdapter.

    Raises:
        ValueError: If ENSTELLAR_MODEL_PROVIDER is not "anthropic" or "ollama".
    """
    if settings.model_provider == "anthropic":
        from enstellar_agents.model_access.anthropic_adapter import AnthropicAdapter

        return AnthropicAdapter(
            api_key=settings.anthropic_api_key,  # type: ignore[arg-type]
            model=settings.model_name,
        )
    if settings.model_provider == "ollama":
        from enstellar_agents.model_access.ollama_adapter import OllamaAdapter

        return OllamaAdapter(base_url=settings.ollama_base_url, model=settings.model_name)
    raise ValueError(
        f"Unknown model_provider: {settings.model_provider!r}."
        " Must be 'anthropic' or 'ollama'."
    )

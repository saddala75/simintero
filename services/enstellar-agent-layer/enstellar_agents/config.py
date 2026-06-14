"""Agent layer settings — loaded from environment variables."""
from __future__ import annotations

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENSTELLAR_", case_sensitive=False)

    model_provider: str = "ollama"          # "anthropic" | "ollama"
    model_name: str = "llama3"
    anthropic_api_key: str | None = None
    ollama_base_url: str = "http://ollama:11434"

    @model_validator(mode="after")
    def _require_api_key_for_anthropic(self) -> "AgentSettings":
        if self.model_provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError(
                "ENSTELLAR_ANTHROPIC_API_KEY is required when ENSTELLAR_MODEL_PROVIDER=anthropic"
            )
        return self


_settings: AgentSettings | None = None


def get_settings() -> AgentSettings:
    global _settings
    if _settings is None:
        _settings = AgentSettings()
    return _settings

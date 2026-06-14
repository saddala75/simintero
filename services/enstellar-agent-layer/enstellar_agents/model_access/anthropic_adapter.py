"""AnthropicAdapter — wraps anthropic.AsyncAnthropic for commercial model access.

Selected when ENSTELLAR_MODEL_PROVIDER=anthropic.
Requires ENSTELLAR_ANTHROPIC_API_KEY to be set.
"""
from __future__ import annotations

import logging

import anthropic

from enstellar_agents.model_access.base import ModelAdapter

logger = logging.getLogger(__name__)


class AnthropicAdapter(ModelAdapter):
    def __init__(self, api_key: str, model: str = "claude-opus-4-8") -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    async def complete(self, system_prompt: str, user_message: str) -> str:
        try:
            msg = await self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
        except anthropic.APIError as exc:
            logger.error("Anthropic API error: model=%s error=%s", self._model, exc)
            raise
        if not msg.content:
            raise RuntimeError(f"Anthropic API returned empty content for model {self._model}")
        return msg.content[0].text

    def model_name(self) -> str:
        return self._model

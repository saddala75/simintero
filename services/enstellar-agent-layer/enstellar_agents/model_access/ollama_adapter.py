"""OllamaAdapter — calls a local Ollama server via HTTP.

Used in local development and boundary deployments where the commercial API is
not available. Configured by ENSTELLAR_OLLAMA_BASE_URL and ENSTELLAR_MODEL_NAME.
"""
from __future__ import annotations

import httpx

from enstellar_agents.model_access.base import ModelAdapter


class OllamaAdapter(ModelAdapter):
    def __init__(
        self,
        base_url: str = "http://ollama:11434",
        model: str = "llama3",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def complete(self, system_prompt: str, user_message: str) -> str:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self._base_url}/api/generate",
                json={
                    "model": self._model,
                    "prompt": f"{system_prompt}\n\n{user_message}",
                    "stream": False,
                },
                timeout=60.0,
            )
            r.raise_for_status()
            return r.json()["response"]

    def model_name(self) -> str:
        return self._model

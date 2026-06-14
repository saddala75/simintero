"""Abstract base class for all model adapters."""
from __future__ import annotations

from abc import ABC, abstractmethod


class ModelAdapter(ABC):
    """Thin interface that all model backends must implement.

    Implementations must be async-safe and stateless (no request-scoped state).
    """

    @abstractmethod
    async def complete(self, system_prompt: str, user_message: str) -> str:
        """Send a prompt to the model and return the response text.

        Args:
            system_prompt: Task instructions. Must not contain PHI.
            user_message:  Case-specific input. Must contain only PHI-minimized fields.

        Returns:
            Raw string response from the model — caller is responsible for parsing.
        """

    @abstractmethod
    def model_name(self) -> str:
        """Return the canonical model identifier (used in provenance records)."""

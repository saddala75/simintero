"""Model-access layer — adapters for Anthropic (commercial) and Ollama (local dev)."""
from enstellar_agents.model_access.base import ModelAdapter
from enstellar_agents.model_access.factory import get_adapter

__all__ = ["ModelAdapter", "get_adapter"]

"""Enstellar integration connectors — Digicore, Revital, terminology."""
from .circuit_breaker import CircuitBreaker, CircuitOpenError
from .digicore.client import DigiCoreClient
from .digicore.models import DecisionRequest, DecisionResponse, StructuredTrace
from .revital.client import RevitalClient
from .revital.models import (
    AnalysisResult,
    CompletenessBlock,
    Gap,
    RevitalUnavailableError,
    TriageBlock,
)
from .revital.phi_minimizer import minimize_for_revital

__all__ = [
    "CircuitBreaker",
    "CircuitOpenError",
    "DigiCoreClient",
    "DecisionRequest",
    "DecisionResponse",
    "StructuredTrace",
    "RevitalClient",
    "RevitalUnavailableError",
    "AnalysisResult",
    "CompletenessBlock",
    "TriageBlock",
    "Gap",
    "minimize_for_revital",
]

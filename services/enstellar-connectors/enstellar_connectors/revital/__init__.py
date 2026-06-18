"""Revital sub-package — client, models, and PHI minimizer."""
from .client import RevitalClient
from .models import (
    AnalysisResult,
    CompletenessBlock,
    Gap,
    RevitalUnavailableError,
    Satisfied,
    TriageBlock,
)
from .phi_minimizer import minimize_for_revital

__all__ = [
    "RevitalClient",
    "RevitalUnavailableError",
    "AnalysisResult",
    "CompletenessBlock",
    "TriageBlock",
    "Gap",
    "Satisfied",
    "minimize_for_revital",
]

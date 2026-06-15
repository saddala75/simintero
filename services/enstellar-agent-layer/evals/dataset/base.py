"""EvalCase schema and DatasetLoader ABC."""
from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class EvalCase(BaseModel):
    case_id: str
    lob: str                    # commercial | medicare | medicaid
    urgency: str                # standard | expedited | concurrent
    procedure_codes: list[str]  # CPT codes
    diagnosis_codes: list[str]  # ICD-10 codes
    doc_requirements: list[str] # payer-required document types
    expected_gaps: list[str]    # ground-truth missing docs
    expected_queue: str         # clinical_review | medical_director | auto_approve
    should_abstain: bool        # True = completeness agent should abstain


class DatasetLoader(ABC):
    @abstractmethod
    def load(self) -> list[EvalCase]: ...

    @property
    @abstractmethod
    def version(self) -> str: ...

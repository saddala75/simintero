"""SyntheticDatasetLoader — 30 hand-crafted EvalCases for agent eval harness."""
from __future__ import annotations

from evals.dataset.base import DatasetLoader, EvalCase

# PHI boundary: codes, urgency, LOB only — no member names, DOBs, NPIs, MRNs.
# Queue mapping enforced: standard→clinical_review, expedited→medical_director, concurrent→auto_approve.

_CASES: list[dict] = [
    # ── Well-specified (001–015): clear gaps, citable criteria ──────────────
    {
        "case_id": "syn-001", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["27447"], "diagnosis_codes": ["M17.11"],
        "doc_requirements": ["operative_report", "clinical_notes", "imaging_report"],
        "expected_gaps": ["operative_report", "clinical_notes", "imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-002", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["27130"], "diagnosis_codes": ["M16.11"],
        "doc_requirements": ["operative_report", "pre_auth_form", "imaging_report"],
        "expected_gaps": ["operative_report", "pre_auth_form", "imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-003", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["33534"], "diagnosis_codes": ["I25.10"],
        "doc_requirements": ["cath_report", "echo_report", "cardiac_consult"],
        "expected_gaps": ["cath_report", "echo_report", "cardiac_consult"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-004", "lob": "medicare", "urgency": "expedited",
        "procedure_codes": ["33533"], "diagnosis_codes": ["I25.110"],
        "doc_requirements": ["cardiac_stress_test", "echo_report"],
        "expected_gaps": ["cardiac_stress_test", "echo_report"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-005", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["71250"], "diagnosis_codes": ["J18.1"],
        "doc_requirements": ["radiology_rx", "prior_imaging_report"],
        "expected_gaps": ["radiology_rx", "prior_imaging_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-006", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["93306"], "diagnosis_codes": ["I48.0"],
        "doc_requirements": ["cardiology_consult", "ecg_report"],
        "expected_gaps": ["cardiology_consult", "ecg_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-007", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["27440"], "diagnosis_codes": ["M17.31"],
        "doc_requirements": ["physical_therapy_notes", "radiology_report"],
        "expected_gaps": ["physical_therapy_notes", "radiology_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-008", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["47562"], "diagnosis_codes": ["K80.20"],
        "doc_requirements": ["ultrasound_report", "surgical_consult"],
        "expected_gaps": ["ultrasound_report", "surgical_consult"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-009", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["70553"], "diagnosis_codes": ["G35"],
        "doc_requirements": ["neuro_consult", "prior_mri_report"],
        "expected_gaps": ["neuro_consult", "prior_mri_report"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-010", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["43239"], "diagnosis_codes": ["K25.0"],
        "doc_requirements": ["gi_consult", "lab_results"],
        "expected_gaps": ["gi_consult", "lab_results"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-011", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["66984"], "diagnosis_codes": ["H26.9"],
        "doc_requirements": ["ophthalmology_exam", "visual_acuity_test"],
        "expected_gaps": ["ophthalmology_exam", "visual_acuity_test"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-012", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["58150"], "diagnosis_codes": ["N80.1"],
        "doc_requirements": ["gyn_consult", "pelvic_ultrasound", "lab_results"],
        "expected_gaps": ["gyn_consult", "pelvic_ultrasound", "lab_results"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-013", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["26116"], "diagnosis_codes": ["M67.40"],
        "doc_requirements": ["radiology_report", "surgical_consult"],
        "expected_gaps": ["radiology_report", "surgical_consult"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-014", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["27403"], "diagnosis_codes": ["M23.202"],
        "doc_requirements": ["mri_report", "orthopedic_consult"],
        "expected_gaps": ["mri_report", "orthopedic_consult"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-015", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["29827"], "diagnosis_codes": ["M75.10"],
        "doc_requirements": ["mri_shoulder_report", "orthopedic_consult", "physical_therapy_record"],
        "expected_gaps": ["mri_shoulder_report", "orthopedic_consult", "physical_therapy_record"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    # ── Ambiguous (016–023): conflicting/unspecified codes → agent should abstain ──
    {
        "case_id": "syn-016", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99213"], "diagnosis_codes": ["Z00.00"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-017", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["97110"], "diagnosis_codes": ["M54.5"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-018", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["99214"], "diagnosis_codes": ["E11.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-019", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99215"], "diagnosis_codes": ["F32.1"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-020", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["90837"], "diagnosis_codes": ["F32.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-021", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["97016"], "diagnosis_codes": ["M54.2"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-022", "lob": "medicare", "urgency": "standard",
        "procedure_codes": ["97014"], "diagnosis_codes": ["M54.3"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    {
        "case_id": "syn-023", "lob": "commercial", "urgency": "standard",
        "procedure_codes": ["99232"], "diagnosis_codes": ["R05.9"],
        "doc_requirements": [], "expected_gaps": [],
        "expected_queue": "clinical_review", "should_abstain": True,
    },
    # ── Triage (024–030): varied urgency/LOB, routing focus ──────────────────
    {
        "case_id": "syn-024", "lob": "commercial", "urgency": "expedited",
        "procedure_codes": ["33533"], "diagnosis_codes": ["I25.10"],
        "doc_requirements": ["cardiac_catheterization_report"],
        "expected_gaps": ["cardiac_catheterization_report"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-025", "lob": "medicare", "urgency": "concurrent",
        "procedure_codes": ["71250"], "diagnosis_codes": ["J18.9"],
        "doc_requirements": ["radiology_prescription"],
        "expected_gaps": ["radiology_prescription"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
    {
        "case_id": "syn-026", "lob": "medicaid", "urgency": "concurrent",
        "procedure_codes": ["27447"], "diagnosis_codes": ["M17.11"],
        "doc_requirements": ["operative_report"],
        "expected_gaps": ["operative_report"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
    {
        "case_id": "syn-027", "lob": "medicare", "urgency": "expedited",
        "procedure_codes": ["93306"], "diagnosis_codes": ["I48.91"],
        "doc_requirements": ["cardiology_consultation_note"],
        "expected_gaps": ["cardiology_consultation_note"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-028", "lob": "medicaid", "urgency": "standard",
        "procedure_codes": ["70553"], "diagnosis_codes": ["G35"],
        "doc_requirements": ["neurology_consultation_note"],
        "expected_gaps": ["neurology_consultation_note"],
        "expected_queue": "clinical_review", "should_abstain": False,
    },
    {
        "case_id": "syn-029", "lob": "medicaid", "urgency": "expedited",
        "procedure_codes": ["47562"], "diagnosis_codes": ["K80.20"],
        "doc_requirements": ["surgical_consultation_note"],
        "expected_gaps": ["surgical_consultation_note"],
        "expected_queue": "medical_director", "should_abstain": False,
    },
    {
        "case_id": "syn-030", "lob": "commercial", "urgency": "concurrent",
        "procedure_codes": ["58150"], "diagnosis_codes": ["N80.0"],
        "doc_requirements": ["gynecology_consultation_note"],
        "expected_gaps": ["gynecology_consultation_note"],
        "expected_queue": "auto_approve", "should_abstain": False,
    },
]


class SyntheticDatasetLoader(DatasetLoader):
    """30 hand-crafted EvalCases covering well-specified, ambiguous, and triage partitions."""

    def load(self) -> list[EvalCase]:
        return [EvalCase(**c) for c in _CASES]

    @property
    def version(self) -> str:
        return "synthetic-v1"

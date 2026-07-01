"""Qualitron Measure Library — catalog browse + tenant activation."""
from __future__ import annotations
import httpx
from fastapi import APIRouter, Depends
from enstellar_bff.auth import require_reviewer, require_medical_director
from enstellar_bff.config import settings

router = APIRouter(prefix="/bff/measures", tags=["measure-library"])

_FALLBACK_ACTIVE: set[str] = {"hedis-col", "hedis-cbp", "hedis-aab", "stars-d12", "qrs-bcs"}

_LIBRARY = [
    {
        "id": "hedis-col", "code": "COL", "program": "HEDIS", "domain": "Cancer Screening",
        "name": "Colorectal Cancer Screening",
        "description": "Percentage of members 46–75 years who had appropriate colorectal cancer screening.",
        "numerator_desc": "Members with qualifying screening (FIT, colonoscopy, FIT-DNA, CT colonography)",
        "denominator_desc": "Members 46–75 continuously enrolled, excluding colorectal cancer history",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 68.2, "p50": 74.8, "p75": 80.1, "p90": 84.7, "national_avg": 74.1},
    },
    {
        "id": "hedis-cbp", "code": "CBP", "program": "HEDIS", "domain": "Cardiovascular Care",
        "name": "Controlling High Blood Pressure",
        "description": "Percentage of members 18–85 years with hypertension whose BP was adequately controlled.",
        "numerator_desc": "Members with most recent BP < 140/90 mmHg",
        "denominator_desc": "Members 18–85 with a hypertension diagnosis",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 58.4, "p50": 65.0, "p75": 70.8, "p90": 75.2, "national_avg": 64.3},
    },
    {
        "id": "hedis-aab", "code": "AAB", "program": "HEDIS", "domain": "Appropriate Treatment",
        "name": "Avoidance of Antibiotic Treatment for Acute Bronchitis/Bronchiolitis",
        "description": "Percentage of episodes where an antibiotic was not prescribed for acute bronchitis.",
        "numerator_desc": "Episodes without antibiotic dispensing event",
        "denominator_desc": "Members 3 months+ with acute bronchitis/bronchiolitis episode",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 28.1, "p50": 34.6, "p75": 41.0, "p90": 48.3, "national_avg": 34.0},
    },
    {
        "id": "hedis-ima", "code": "IMA", "program": "HEDIS", "domain": "Immunizations",
        "name": "Immunizations for Adolescents",
        "description": "Percentage of adolescents 13 years who had recommended immunizations.",
        "numerator_desc": "Members who received Meningococcal, Tdap, and HPV vaccines",
        "denominator_desc": "Members who turned 13 during the measurement year",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 31.5, "p50": 38.2, "p75": 44.9, "p90": 51.3, "national_avg": 37.8},
    },
    {
        "id": "hedis-spc", "code": "SPC", "program": "HEDIS", "domain": "Cardiovascular Care",
        "name": "Statin Therapy for Patients with Cardiovascular Disease",
        "description": "Percentage of male members 21–75 and female members 40–75 with ASCVD on statin therapy.",
        "numerator_desc": "Members who received high/moderate intensity statin therapy",
        "denominator_desc": "Members with ASCVD diagnosis and qualifying continuous enrollment",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 72.1, "p50": 77.4, "p75": 82.0, "p90": 85.6, "national_avg": 76.9},
    },
    {
        "id": "hedis-eed", "code": "EED", "program": "HEDIS", "domain": "Diabetes",
        "name": "Eye Exam for Patients with Diabetes",
        "description": "Percentage of members 18–75 with diabetes who had a retinal eye exam.",
        "numerator_desc": "Members with a retinal or dilated eye exam during the year",
        "denominator_desc": "Members 18–75 with Type 1 or Type 2 diabetes",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "HEDIS 2026",
        "benchmarks": {"p25": 54.3, "p50": 61.7, "p75": 67.4, "p90": 72.1, "national_avg": 61.0},
    },
    {
        "id": "stars-d12", "code": "D12", "program": "CMS Stars", "domain": "Diabetes",
        "name": "Diabetes Care – Blood Sugar Controlled (HbA1c < 9%)",
        "description": "Percentage of Medicare Advantage members with diabetes with HbA1c under control.",
        "numerator_desc": "Members whose most recent HbA1c is < 9.0%",
        "denominator_desc": "Medicare Advantage members 18–75 with diabetes",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Stars 2026",
        "benchmarks": {"p25": 76.2, "p50": 80.5, "p75": 84.1, "p90": 87.3, "national_avg": 80.1},
    },
    {
        "id": "stars-c17", "code": "C17", "program": "CMS Stars", "domain": "Cancer Screening",
        "name": "Breast Cancer Screening",
        "description": "Percentage of women 50–74 who had a mammogram to screen for breast cancer.",
        "numerator_desc": "Members with mammogram in measurement period or prior year",
        "denominator_desc": "Female Medicare Advantage members 50–74",
        "reporting_period": "Annual (Oct 1 Y-1 – Sep 30 Y)", "source_version": "CMS Stars 2026",
        "benchmarks": {"p25": 63.8, "p50": 70.2, "p75": 75.6, "p90": 79.4, "national_avg": 69.7},
    },
    {
        "id": "stars-c18", "code": "C18", "program": "CMS Stars", "domain": "Cardiovascular Care",
        "name": "Controlling Blood Pressure (Medicare)",
        "description": "Percentage of Medicare Advantage members with hypertension with controlled BP < 140/90.",
        "numerator_desc": "Members with most recent BP reading < 140/90",
        "denominator_desc": "Medicare Advantage members with hypertension, 18–85",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Stars 2026",
        "benchmarks": {"p25": 62.1, "p50": 68.4, "p75": 73.9, "p90": 78.2, "national_avg": 67.8},
    },
    {
        "id": "stars-spd", "code": "SPD", "program": "CMS Stars", "domain": "Drug Safety",
        "name": "Medication Adherence for Diabetes Medications",
        "description": "Percentage of Medicare Advantage members with diabetes who adhere to antidiabetic meds (PDC >= 80%).",
        "numerator_desc": "Members with proportion of days covered (PDC) >= 80%",
        "denominator_desc": "Medicare Advantage members with diabetes on antidiabetic medications",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Stars 2026",
        "benchmarks": {"p25": 82.3, "p50": 86.7, "p75": 89.4, "p90": 91.8, "national_avg": 86.2},
    },
    {
        "id": "qrs-bcs", "code": "BCS-E", "program": "QRS", "domain": "Cancer Screening",
        "name": "Breast Cancer Screening (Exchange)",
        "description": "Percentage of commercial exchange women 50–74 who received mammography screening.",
        "numerator_desc": "Members with mammogram in measurement period or year prior",
        "denominator_desc": "Female commercial exchange members 50–74",
        "reporting_period": "Annual (Oct 1 Y-1 – Sep 30 Y)", "source_version": "QRS 2026",
        "benchmarks": {"p25": 58.1, "p50": 64.7, "p75": 70.3, "p90": 75.1, "national_avg": 64.2},
    },
    {
        "id": "qrs-col-e", "code": "COL-E", "program": "QRS", "domain": "Cancer Screening",
        "name": "Colorectal Cancer Screening (Exchange)",
        "description": "Percentage of commercial exchange members 46–75 with appropriate colorectal cancer screening.",
        "numerator_desc": "Members with qualifying screening test",
        "denominator_desc": "Commercial exchange members 46–75 continuously enrolled",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "QRS 2026",
        "benchmarks": {"p25": 55.4, "p50": 62.1, "p75": 68.8, "p90": 74.3, "national_avg": 61.8},
    },
    {
        "id": "medicaid-wcc", "code": "WCC", "program": "Medicaid", "domain": "Child Health",
        "name": "Weight Assessment and Counseling for Nutrition and Physical Activity for Children/Adolescents",
        "description": "Percentage of Medicaid members 3–17 with a well-care visit who had BMI, nutrition, and physical activity counseling.",
        "numerator_desc": "Members with BMI percentile documented and counseling for nutrition and physical activity",
        "denominator_desc": "Medicaid members 3–17 with at least one well-care visit",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Medicaid Core Set 2026",
        "benchmarks": {"p25": 41.2, "p50": 48.6, "p75": 55.1, "p90": 61.4, "national_avg": 48.0},
    },
    {
        "id": "medicaid-amd", "code": "AMD", "program": "Medicaid", "domain": "Behavioral Health",
        "name": "Annual Monitoring for Patients on Persistent Medications",
        "description": "Percentage of Medicaid members on persistent medications who had required lab monitoring.",
        "numerator_desc": "Members who received appropriate lab test during the year",
        "denominator_desc": "Medicaid members on ACE inhibitors, ARBs, or digoxin",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Medicaid Core Set 2026",
        "benchmarks": {"p25": 70.8, "p50": 76.3, "p75": 81.2, "p90": 85.0, "national_avg": 75.9},
    },
    {
        "id": "medicaid-fua", "code": "FUA", "program": "Medicaid", "domain": "Behavioral Health",
        "name": "Follow-Up After Emergency Department Visit for Alcohol and Other Drug Abuse",
        "description": "Percentage of ED visits for alcohol/drug abuse with follow-up within 30 days.",
        "numerator_desc": "ED visits followed by outpatient/intensive treatment within 7 or 30 days",
        "denominator_desc": "Medicaid ED visits with principal diagnosis of alcohol or drug abuse",
        "reporting_period": "Annual (Jan 1 – Dec 31)", "source_version": "CMS Medicaid Core Set 2026",
        "benchmarks": {"p25": 22.4, "p50": 29.8, "p75": 37.1, "p90": 44.6, "national_avg": 29.3},
    },
]


def _with_active(library: list[dict], active_set: set[str]) -> list[dict]:
    return [{**m, "active": m["id"] in active_set} for m in library]


async def _fetch_active(tenant_id: str) -> set[str]:
    try:
        async with httpx.AsyncClient(base_url=settings.qualitron_reporting_url, timeout=5.0) as c:
            r = await c.get(
                "/v1/quality/measures/activation",
                headers={"x-sim-tenant-id": tenant_id},
            )
        r.raise_for_status()
        data = r.json()
        return set(data.get("active", []))
    except Exception:
        return set(_FALLBACK_ACTIVE)


@router.get("/library")
async def get_measure_library(auth: tuple = Depends(require_reviewer)):
    """Return the full measure catalog with tenant activation status."""
    ctx, _ = auth
    active = await _fetch_active(ctx.tenant_id)
    return _with_active(_LIBRARY, active)


@router.post("/library/{measure_id}/activate")
async def activate_measure(measure_id: str, auth: tuple = Depends(require_medical_director)):
    """Activate a measure for this tenant. Requires medical_director role."""
    if not any(m["id"] == measure_id for m in _LIBRARY):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Measure {measure_id} not found")
    ctx, _ = auth
    async with httpx.AsyncClient(base_url=settings.qualitron_reporting_url, timeout=5.0) as c:
        r = await c.post(
            f"/v1/quality/measures/{measure_id}/activate",
            headers={"x-sim-tenant-id": ctx.tenant_id},
        )
        r.raise_for_status()
    return {"id": measure_id, "active": True}


@router.post("/library/{measure_id}/deactivate")
async def deactivate_measure(measure_id: str, auth: tuple = Depends(require_medical_director)):
    """Deactivate a measure for this tenant. Requires medical_director role."""
    ctx, _ = auth
    async with httpx.AsyncClient(base_url=settings.qualitron_reporting_url, timeout=5.0) as c:
        r = await c.delete(
            f"/v1/quality/measures/{measure_id}/activate",
            headers={"x-sim-tenant-id": ctx.tenant_id},
        )
        r.raise_for_status()
    return {"id": measure_id, "active": False}

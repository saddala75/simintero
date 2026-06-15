"""PHI minimizer for Revital requests.

minimize_for_revital(case_data) returns a copy of case_data with PHI fields
removed, safe for use when constructing a SummarizeRequest.

This enforces invariant #3 (PHI minimum-necessary): raw member data must
never reach the Revital inference endpoint. The minimizer removes PHI from
both the top-level dict and from the nested 'member' sub-dict.

Usage (in agent-layer, before calling RevitalClient)::

    minimized = minimize_for_revital(case_data)
    req = SummarizeRequest(
        case_id=minimized["case_id"],
        tenant_id=minimized["tenant_id"],
        service_codes=minimized.get("service_codes", []),
        diagnosis_codes=minimized.get("diagnosis_codes", []),
        lob=minimized.get("lob", ""),
        urgency=minimized.get("urgency", ""),
        doc_requirements=minimized.get("doc_requirements", []),
    )
    resp = await revital_client.summarize(req)

Never pass `case_data` directly to SummarizeRequest or RevitalClient.
"""
from __future__ import annotations

# PHI field names that must never appear in a SummarizeRequest.
# Extend this frozenset if new PHI field names are identified in canonical-model.
_PHI_FIELDS: frozenset[str] = frozenset({
    "member_name",
    "first_name",
    "last_name",
    "middle_name",
    "dob",
    "date_of_birth",
    "ssn",
    "social_security_number",
    "address",
    "street_address",
    "city",
    "state",
    "zip",
    "zip_code",
    "phone",
    "phone_number",
    "email",
    "email_address",
    "member_id_raw",
    "mrn",
    "identifiers",
    "gender",
})


def minimize_for_revital(case_data: dict) -> dict:
    """Return a shallow copy of case_data with PHI fields removed.

    PHI fields are stripped from both the top-level dict and from the nested
    ``member`` sub-dict (if present and if it is a dict). All other top-level
    keys and values are preserved unchanged. The original case_data is never
    mutated.

    Args:
        case_data: Raw case dict. May contain PHI at the top level and/or
                   inside a ``member`` sub-dict.

    Returns:
        A new dict with PHI fields removed, safe for use in SummarizeRequest
        construction.
    """
    result = {k: v for k, v in case_data.items() if k not in _PHI_FIELDS}
    if "member" in result and isinstance(result["member"], dict):
        result["member"] = {
            k: v for k, v in result["member"].items() if k not in _PHI_FIELDS
        }
    return result

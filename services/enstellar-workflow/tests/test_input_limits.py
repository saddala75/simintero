"""Tests for input length limit enforcement on free-text fields.

Verifies that oversized payloads return 422 Unprocessable Entity,
preventing multi-megabyte DB bloat from description, resolution,
and free_text fields.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from enstellar_workflow.grievances.api import FileGrievanceBody, ResolveGrievanceBody


def test_grievance_description_too_long():
    """description field must reject strings > 10_000 chars."""
    with pytest.raises(ValidationError) as exc_info:
        FileGrievanceBody(
            member_ref="m1",
            filed_by="coordinator-abc",
            description="x" * 10_001,
            category="billing",
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("description",) for e in errors)
    assert any("max_length" in str(e["type"]) or "string_too_long" in str(e["type"]) for e in errors)


def test_grievance_description_at_limit_ok():
    """description at exactly 10_000 chars must be accepted."""
    body = FileGrievanceBody(
        member_ref="m1",
        filed_by="coordinator-abc",
        description="x" * 10_000,
        category="billing",
    )
    assert len(body.description) == 10_000  # type: ignore[arg-type]


def test_grievance_resolution_too_long():
    """resolution field must reject strings > 10_000 chars."""
    with pytest.raises(ValidationError) as exc_info:
        ResolveGrievanceBody(resolution="y" * 10_001)
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("resolution",) for e in errors)


def test_grievance_category_too_long():
    """category field must reject strings > 128 chars."""
    with pytest.raises(ValidationError) as exc_info:
        FileGrievanceBody(
            member_ref="m1",
            filed_by="coordinator-abc",
            category="c" * 129,
        )
    errors = exc_info.value.errors()
    assert any(e["loc"] == ("category",) for e in errors)


def test_grievance_member_ref_too_long():
    """member_ref must reject strings > 256 chars."""
    with pytest.raises(ValidationError):
        FileGrievanceBody(
            member_ref="m" * 257,
            filed_by="coordinator-abc",
        )

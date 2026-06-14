"""EventEnvelope — canonical C-3 event envelope for all Enstellar events."""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, computed_field, field_validator


class ActorType(StrEnum):
    USER = "user"
    SYSTEM = "system"
    SERVICE = "service"


class Actor(BaseModel):
    id: str
    type: ActorType

    model_config = {"extra": "forbid"}


class EventEnvelope(BaseModel):
    event_id: uuid.UUID
    tenant_id: str = Field(min_length=1, description="Required: tenant owning this event")
    case_id: uuid.UUID | None = None
    correlation_id: str
    schema_ref: str = Field(
        description="C-3 schema reference: topic/EventName/version",
        pattern=r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+/[A-Za-z][A-Za-z0-9]*/v\d+$",
    )
    causation_id: str | None = None
    trace_ref: str | None = None
    occurred_at: datetime
    actor: Actor
    payload: dict[str, Any]

    model_config = {"extra": "forbid"}

    @computed_field
    @property
    def type(self) -> str:
        """Kafka topic — first path segment of schema_ref."""
        return self.schema_ref.split("/")[0]

    @computed_field
    @property
    def schema_version(self) -> str:
        """Schema version — last path segment of schema_ref."""
        parts = self.schema_ref.split("/")
        return parts[-1] if len(parts) >= 3 else "v1"

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v

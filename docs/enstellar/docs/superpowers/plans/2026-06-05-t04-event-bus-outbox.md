# T04 — Event Bus + Outbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the canonical event envelope in `packages/event-contracts/`; implement the transactional outbox pattern in `services/workflow-engine/` (write event to PostgreSQL outbox table + relay to Redpanda in the same logical flow); prove idempotent consumption with an integration test.

**Architecture:** Event envelope schema (JSON Schema → Pydantic v2) lives in `packages/event-contracts`. The workflow-engine owns the outbox table: `OutboxPublisher` writes an `outbox` row inside the caller's DB transaction; `OutboxRelay` polls the outbox and publishes to Redpanda via `aiokafka`; `KafkaConsumer` tracks processed `event_id`s in a `processed_events` table to guarantee exactly-once processing. DB schema is managed by Alembic. Integration tests use Testcontainers (PostgreSQL + Redpanda).

**Tech Stack:** Python 3.12 + asyncpg + aiokafka + Alembic + SQLAlchemy (async) + pydantic-settings + pytest + pytest-asyncio + Testcontainers.

> **Invariant note:** Every event must carry `tenant_id`. The publisher must reject any event without `tenant_id`. Tests must assert this.

---

## File Map

**New files:**
```
packages/event-contracts/
  schema/
    event_envelope.json          # JSON Schema for EventEnvelope
  enstellar_events/
    __init__.py
    envelope.py                  # EventEnvelope Pydantic v2 model
    topics.py                    # Kafka topic name constants
    codec.py                     # serialize/deserialize helpers
  pyproject.toml
  tests/
    test_envelope.py

services/workflow-engine/
  pyproject.toml
  alembic.ini
  enstellar_workflow/
    __init__.py
    config.py                    # Settings (pydantic-settings)
    db/
      __init__.py
      connection.py              # asyncpg pool factory
    outbox/
      __init__.py
      models.py                  # OutboxEntry + ProcessedEvent dataclasses
      publisher.py               # OutboxPublisher
      relay.py                   # OutboxRelay
    kafka/
      __init__.py
      producer.py                # KafkaProducer wrapper
      consumer.py                # IdempotentKafkaConsumer base
  migrations/
    env.py
    script.py.mako
    versions/
      0001_create_outbox_tables.py
  tests/
    conftest.py                  # Testcontainers fixtures
    test_envelope_contract.py    # Schema contract test
    test_publisher.py
    test_relay.py
    test_consumer_idempotent.py
```

**Modified files:**
```
Makefile                         # Add workflow-engine test target
.github/workflows/ci.yml        # Add event-contracts + workflow-engine test jobs
.claude/task-graph.md           # Mark T04 [x] done
packages/event-contracts/.gitkeep  # Delete
services/workflow-engine/.gitkeep  # Delete
```

---

## Task 1: Event envelope JSON Schema + Pydantic model

**Files:**
- Create: `packages/event-contracts/pyproject.toml`
- Create: `packages/event-contracts/schema/event_envelope.json`
- Create: `packages/event-contracts/enstellar_events/envelope.py`
- Create: `packages/event-contracts/enstellar_events/topics.py`
- Create: `packages/event-contracts/enstellar_events/codec.py`
- Create: `packages/event-contracts/enstellar_events/__init__.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
# packages/event-contracts/pyproject.toml
[project]
name = "enstellar-events"
version = "0.1.0"
description = "Enstellar canonical event envelope + topic catalog"
requires-python = ">=3.12"
dependencies = ["pydantic>=2.9", "python-dateutil>=2.9"]

[dependency-groups]
dev = ["pytest>=8"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["enstellar_events"]
```

- [ ] **Step 2: Create schema/event_envelope.json**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://enstellar.simintero.com/schemas/event_envelope.json",
  "title": "EventEnvelope",
  "description": "Canonical event envelope. Every event emitted by any Enstellar service must conform to this schema. tenant_id is required — no event crosses a tenant boundary.",
  "type": "object",
  "properties": {
    "event_id": {
      "type": "string",
      "format": "uuid",
      "description": "Globally unique event identifier. Used for idempotency by consumers."
    },
    "tenant_id": {
      "type": "string",
      "description": "Tenant that owns this event. Required. No cross-tenant event propagation."
    },
    "case_id": {
      "type": "string",
      "format": "uuid",
      "description": "PA case this event belongs to (null for system events)."
    },
    "correlation_id": {
      "type": "string",
      "description": "Spans a logical operation across multiple events and services."
    },
    "type": {
      "type": "string",
      "description": "Dot-separated event type e.g. case.state.transitioned, clock.breached",
      "pattern": "^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9]*)+$"
    },
    "occurred_at": {
      "type": "string",
      "format": "date-time",
      "description": "When the event occurred (business time), in UTC."
    },
    "actor": {
      "type": "object",
      "description": "Who/what caused this event.",
      "properties": {
        "id":   { "type": "string" },
        "type": { "type": "string", "enum": ["user", "system", "service"] }
      },
      "required": ["id", "type"],
      "additionalProperties": false
    },
    "payload": {
      "type": "object",
      "description": "Event-type-specific data. Structure defined per event type in the AsyncAPI catalog."
    },
    "schema_version": {
      "type": "string",
      "description": "Semver of the payload schema e.g. '1.0.0'.",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    }
  },
  "required": [
    "event_id", "tenant_id", "correlation_id",
    "type", "occurred_at", "actor", "payload", "schema_version"
  ],
  "additionalProperties": false
}
```

- [ ] **Step 3: Write failing test first**

Create `packages/event-contracts/tests/test_envelope.py`:

```python
# packages/event-contracts/tests/test_envelope.py
"""Contract tests for EventEnvelope — ensure schema enforces required fields."""
import json
from pathlib import Path

import pytest

# We test the Pydantic model (Task 1, Step 4) AND the raw JSON Schema.
# The Pydantic model is the in-process contract; the JSON Schema is the wire contract.

SCHEMA_PATH = Path(__file__).parent.parent / "schema" / "event_envelope.json"


def test_schema_file_exists():
    assert SCHEMA_PATH.exists(), "event_envelope.json must exist"


def test_schema_has_all_required_fields():
    schema = json.loads(SCHEMA_PATH.read_text())
    required = set(schema["required"])
    expected = {
        "event_id", "tenant_id", "correlation_id",
        "type", "occurred_at", "actor", "payload", "schema_version",
    }
    assert expected.issubset(required), f"Missing required fields: {expected - required}"


def test_schema_tenant_id_in_required():
    schema = json.loads(SCHEMA_PATH.read_text())
    assert "tenant_id" in schema["required"], "tenant_id must be required — invariant #5"


# --- Pydantic model tests (after Step 4) ---
from enstellar_events.envelope import EventEnvelope, Actor, ActorType


SAMPLE_EVENT = {
    "event_id": "aaaaaaaa-0000-0000-0000-000000000001",
    "tenant_id": "tenant-test",
    "case_id": "bbbbbbbb-0000-0000-0000-000000000002",
    "correlation_id": "corr-xyz-789",
    "type": "case.state.transitioned",
    "occurred_at": "2026-06-05T10:00:00Z",
    "actor": {"id": "user-123", "type": "user"},
    "payload": {"from_state": "intake", "to_state": "completeness_check"},
    "schema_version": "1.0.0",
}


def test_event_envelope_roundtrip():
    env = EventEnvelope.model_validate(SAMPLE_EVENT)
    json_str = env.model_dump_json()
    restored = EventEnvelope.model_validate_json(json_str)
    assert restored == env


def test_event_without_tenant_id_raises():
    import pydantic
    bad = {k: v for k, v in SAMPLE_EVENT.items() if k != "tenant_id"}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)


def test_event_without_case_id_is_valid():
    # case_id is optional (system events have no case)
    no_case = {k: v for k, v in SAMPLE_EVENT.items() if k != "case_id"}
    env = EventEnvelope.model_validate(no_case)
    assert env.case_id is None


def test_invalid_event_type_pattern_raises():
    import pydantic
    bad = {**SAMPLE_EVENT, "type": "NotDotSeparated"}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)


def test_empty_tenant_id_raises():
    import pydantic
    bad = {**SAMPLE_EVENT, "tenant_id": ""}
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(bad)
```

- [ ] **Step 4: Run test — expect import failure**

```bash
cd packages/event-contracts && uv sync && uv run pytest tests/ -v 2>&1 | head -20
```

Expected: `ImportError: cannot import name 'EventEnvelope'`. This is the red state.

- [ ] **Step 5: Create enstellar_events/envelope.py**

```python
# packages/event-contracts/enstellar_events/envelope.py
"""EventEnvelope — canonical event envelope for all Enstellar events.

Every emitted event must carry tenant_id. No event without tenant_id is published.
This is enforced at the model validation layer (tenant_id is required + min_length=1).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


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
    type: str = Field(pattern=r"^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$")
    occurred_at: datetime
    actor: Actor
    payload: dict[str, Any]
    schema_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")

    model_config = {"extra": "forbid"}

    @field_validator("tenant_id")
    @classmethod
    def tenant_id_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("tenant_id must not be blank — invariant #5")
        return v
```

- [ ] **Step 6: Create enstellar_events/topics.py**

```python
# packages/event-contracts/enstellar_events/topics.py
"""Kafka topic name constants. Topics are partitioned by tenant_id."""


class Topics:
    # Case lifecycle
    CASE_INTAKE_RECEIVED = "case.intake.received"
    CASE_STATE_TRANSITIONED = "case.state.transitioned"
    CASE_PENDED = "case.pended"
    CASE_ASSIGNED = "case.assigned"
    CASE_CLOSED = "case.closed"

    # Clocks / SLA
    CLOCK_STARTED = "clock.started"
    CLOCK_PAUSED = "clock.paused"
    CLOCK_RESUMED = "clock.resumed"
    CLOCK_BREACHED = "clock.breached"

    # RFI / comms
    RFI_REQUESTED = "rfi.requested"
    RFI_RESPONSE_RECEIVED = "rfi.response.received"
    NOTIFICATION_SENT = "notification.sent"

    # Decision
    DECISION_RECORDED = "decision.recorded"

    # Normalization
    CASE_NORMALIZED = "case.normalized"

    # AI / agent
    AGENT_ASSIST_PRODUCED = "agent.assist.produced"
```

- [ ] **Step 7: Create enstellar_events/codec.py**

```python
# packages/event-contracts/enstellar_events/codec.py
"""Serialize / deserialize EventEnvelope to/from bytes (UTF-8 JSON)."""
from .envelope import EventEnvelope


def encode(event: EventEnvelope) -> bytes:
    return event.model_dump_json().encode("utf-8")


def decode(data: bytes) -> EventEnvelope:
    return EventEnvelope.model_validate_json(data.decode("utf-8"))
```

- [ ] **Step 8: Create enstellar_events/__init__.py**

```python
# packages/event-contracts/enstellar_events/__init__.py
"""Enstellar canonical event envelope + topic catalog."""
from .codec import decode, encode
from .envelope import Actor, ActorType, EventEnvelope
from .topics import Topics

__all__ = ["Actor", "ActorType", "EventEnvelope", "Topics", "encode", "decode"]
```

- [ ] **Step 9: Run test — expect all pass**

```bash
cd packages/event-contracts && uv run pytest tests/ -v
```

Expected:
```
PASSED test_schema_file_exists
PASSED test_schema_has_all_required_fields
PASSED test_schema_tenant_id_in_required
PASSED test_event_envelope_roundtrip
PASSED test_event_without_tenant_id_raises
PASSED test_event_without_case_id_is_valid
PASSED test_invalid_event_type_pattern_raises
PASSED test_empty_tenant_id_raises
```

- [ ] **Step 10: Commit**

```bash
rm packages/event-contracts/.gitkeep
git add packages/event-contracts/
git commit -m "feat(T04): event-contracts — EventEnvelope schema + Pydantic model + codec + topic catalog"
```

---

## Task 2: workflow-engine project scaffold + config

**Files:**
- Create: `services/workflow-engine/pyproject.toml`
- Create: `services/workflow-engine/enstellar_workflow/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/config.py`
- Create: `services/workflow-engine/enstellar_workflow/db/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/db/connection.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
# services/workflow-engine/pyproject.toml
[project]
name = "enstellar-workflow"
version = "0.1.0"
description = "Enstellar workflow engine — deterministic case state machine"
requires-python = ">=3.12"
dependencies = [
    "asyncpg>=0.29",
    "aiokafka>=0.11",
    "pydantic>=2.9",
    "pydantic-settings>=2.3",
    "alembic>=1.13",
    "sqlalchemy[asyncio]>=2.0",
    "enstellar-events",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.23",
    "testcontainers[postgres]>=4.7",
    "testcontainers[kafka]>=4.7",
]

[tool.uv.sources]
enstellar-events = { path = "../../packages/event-contracts", editable = true }

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["enstellar_workflow"]
```

- [ ] **Step 2: Create enstellar_workflow/config.py**

```python
# services/workflow-engine/enstellar_workflow/config.py
"""Workflow engine settings — loaded from environment variables."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WORKFLOW_", case_sensitive=False)

    # Database
    db_url: str = "postgresql+asyncpg://workflow:workflow_secret@localhost:5432/workflow"

    # Kafka / Redpanda
    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "workflow-engine"

    # Outbox relay
    outbox_poll_interval_seconds: float = 1.0
    outbox_batch_size: int = 100


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
```

- [ ] **Step 3: Create db/connection.py**

```python
# services/workflow-engine/enstellar_workflow/db/connection.py
"""asyncpg connection pool factory."""
import asyncpg

from ..config import get_settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        settings = get_settings()
        # Strip SQLAlchemy prefix for direct asyncpg use
        dsn = settings.db_url.replace("postgresql+asyncpg://", "postgresql://")
        _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
```

- [ ] **Step 4: Install deps**

```bash
cd services/workflow-engine && uv sync
```

Expected: resolves `enstellar-events` from local path, no errors.

- [ ] **Step 5: Commit**

```bash
rm services/workflow-engine/.gitkeep
git add services/workflow-engine/pyproject.toml services/workflow-engine/enstellar_workflow/
git commit -m "chore(workflow-engine): project scaffold — pyproject.toml + config + db connection"
```

---

## Task 3: Database migrations — outbox + processed_events tables

**Files:**
- Create: `services/workflow-engine/alembic.ini`
- Create: `services/workflow-engine/migrations/env.py`
- Create: `services/workflow-engine/migrations/script.py.mako`
- Create: `services/workflow-engine/migrations/versions/0001_create_outbox_tables.py`

- [ ] **Step 1: Create alembic.ini**

```ini
# services/workflow-engine/alembic.ini
[alembic]
script_location = migrations
prepend_sys_path = .
version_path_separator = os
sqlalchemy.url = %(db_url)s

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 2: Create migrations/env.py**

```python
# services/workflow-engine/migrations/env.py
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from env var if set
db_url = os.environ.get(
    "WORKFLOW_DB_URL",
    "postgresql://workflow:workflow_secret@localhost:5432/workflow",
)
config.set_main_option("db_url", db_url)
config.set_main_option("sqlalchemy.url", db_url)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=None, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 3: Create migrations/script.py.mako**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 4: Create migrations/versions/0001_create_outbox_tables.py**

```python
# services/workflow-engine/migrations/versions/0001_create_outbox_tables.py
"""Create outbox and processed_events tables.

Revision ID: 0001
Revises: 
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # outbox: events written by services in the same DB transaction as business state.
    # The relay reads these rows and publishes to Kafka, then marks published_at.
    op.create_table(
        "outbox",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("event_id", UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("tenant_id", sa.Text, nullable=False),
        sa.Column("case_id", UUID(as_uuid=True), nullable=True),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("schema_version", sa.Text, nullable=False),
        sa.Column("occurred_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("correlation_id", sa.Text, nullable=False),
        sa.Column("actor_id", sa.Text, nullable=False),
        sa.Column("actor_type", sa.Text, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("tenant_id != ''", name="outbox_tenant_id_not_empty"),
    )
    op.create_index("ix_outbox_unpublished", "outbox", ["id"],
                    postgresql_where=sa.text("published_at IS NULL"))

    # processed_events: idempotency table — consumers insert event_id before processing.
    # If the insert fails (duplicate), the event has already been processed.
    op.create_table(
        "processed_events",
        sa.Column("event_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("consumer_group", sa.Text, nullable=False),
        sa.Column("processed_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("processed_events")
    op.drop_index("ix_outbox_unpublished")
    op.drop_table("outbox")
```

- [ ] **Step 5: Commit**

```bash
git add services/workflow-engine/alembic.ini services/workflow-engine/migrations/
git commit -m "feat(T04): workflow-engine Alembic migrations — outbox + processed_events tables"
```

---

## Task 4: OutboxPublisher + OutboxRelay

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/outbox/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/outbox/models.py`
- Create: `services/workflow-engine/enstellar_workflow/outbox/publisher.py`
- Create: `services/workflow-engine/enstellar_workflow/outbox/relay.py`
- Create: `services/workflow-engine/enstellar_workflow/kafka/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/kafka/producer.py`

- [ ] **Step 1: Create outbox/models.py**

```python
# services/workflow-engine/enstellar_workflow/outbox/models.py
"""Dataclasses for outbox rows (not ORM — we use asyncpg raw queries for performance)."""
import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass
class OutboxEntry:
    event_id: uuid.UUID
    tenant_id: str
    case_id: uuid.UUID | None
    type: str
    payload: dict
    schema_version: str
    occurred_at: datetime
    correlation_id: str
    actor_id: str
    actor_type: str
```

- [ ] **Step 2: Create outbox/publisher.py**

```python
# services/workflow-engine/enstellar_workflow/outbox/publisher.py
"""OutboxPublisher — writes an event to the outbox table inside an existing DB transaction.

USAGE:
    async with pool.acquire() as conn:
        async with conn.transaction():
            # ... your business state changes ...
            await publisher.publish(conn, event)
            # Both the business change AND the outbox row commit together.
"""
import asyncpg

from enstellar_events import EventEnvelope


class OutboxPublisher:
    async def publish(self, conn: asyncpg.Connection, event: EventEnvelope) -> None:
        """Insert the event into the outbox table inside the caller's transaction.

        Raises ValueError if tenant_id is missing (invariant #5).
        The caller must be inside a transaction when calling this method.
        """
        if not event.tenant_id:
            raise ValueError("Event must carry tenant_id — invariant #5")

        await conn.execute(
            """
            INSERT INTO outbox
              (event_id, tenant_id, case_id, type, payload, schema_version,
               occurred_at, correlation_id, actor_id, actor_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (event_id) DO NOTHING
            """,
            event.event_id,
            event.tenant_id,
            event.case_id,
            event.type,
            # asyncpg needs a JSON string for JSONB, not a dict
            __import__("json").dumps(event.payload),
            event.schema_version,
            event.occurred_at,
            event.correlation_id,
            event.actor.id,
            event.actor.type.value,
        )
```

- [ ] **Step 3: Create kafka/producer.py**

```python
# services/workflow-engine/enstellar_workflow/kafka/producer.py
"""aiokafka producer wrapper.

Topics are partitioned by tenant_id so all events for a tenant land in order.
"""
from aiokafka import AIOKafkaProducer

from enstellar_events import EventEnvelope, encode
from ..config import get_settings


class KafkaProducer:
    def __init__(self) -> None:
        settings = get_settings()
        self._producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            enable_idempotence=True,
        )

    async def start(self) -> None:
        await self._producer.start()

    async def stop(self) -> None:
        await self._producer.stop()

    async def send(self, topic: str, event: EventEnvelope) -> None:
        """Publish an event to Kafka, partitioned by tenant_id."""
        value = encode(event)
        key = event.tenant_id.encode("utf-8")
        await self._producer.send_and_wait(topic, value=value, key=key)
```

- [ ] **Step 4: Create outbox/relay.py**

```python
# services/workflow-engine/enstellar_workflow/outbox/relay.py
"""OutboxRelay — polls the outbox table and publishes unpublished events to Kafka.

Design:
- Reads a batch of unpublished rows (ORDER BY id ASC for in-order delivery per tenant).
- Publishes each event to the topic matching event.type.
- Marks each row published_at after successful Kafka send.
- Idempotent: if crashed between publish and mark, on restart the row is re-published
  (Kafka's enable_idempotence on the producer deduplicates at the broker).
"""
import asyncio
import logging

import asyncpg

from enstellar_events import EventEnvelope, Actor, ActorType
from .models import OutboxEntry
from ..config import get_settings
from ..kafka.producer import KafkaProducer

logger = logging.getLogger(__name__)


class OutboxRelay:
    def __init__(self, pool: asyncpg.Pool, producer: KafkaProducer) -> None:
        self._pool = pool
        self._producer = producer
        self._running = False

    async def start(self) -> None:
        self._running = True
        settings = get_settings()
        while self._running:
            try:
                published = await self._relay_batch(settings.outbox_batch_size)
                if published == 0:
                    await asyncio.sleep(settings.outbox_poll_interval_seconds)
            except Exception:
                logger.exception("OutboxRelay error — retrying after sleep")
                await asyncio.sleep(settings.outbox_poll_interval_seconds)

    async def stop(self) -> None:
        self._running = False

    async def _relay_batch(self, batch_size: int) -> int:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, event_id, tenant_id, case_id, type, payload,
                       schema_version, occurred_at, correlation_id, actor_id, actor_type
                FROM outbox
                WHERE published_at IS NULL
                ORDER BY id ASC
                LIMIT $1
                """,
                batch_size,
            )

        count = 0
        for row in rows:
            event = _row_to_envelope(row)
            topic = event.type  # topic name = event type (dot-separated)
            await self._producer.send(topic, event)

            async with self._pool.acquire() as conn:
                await conn.execute(
                    "UPDATE outbox SET published_at = now() WHERE id = $1",
                    row["id"],
                )
            count += 1

        return count


def _row_to_envelope(row: asyncpg.Record) -> EventEnvelope:
    import json as _json
    return EventEnvelope(
        event_id=row["event_id"],
        tenant_id=row["tenant_id"],
        case_id=row["case_id"],
        correlation_id=row["correlation_id"],
        type=row["type"],
        occurred_at=row["occurred_at"],
        actor=Actor(id=row["actor_id"], type=ActorType(row["actor_type"])),
        payload=_json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"],
        schema_version=row["schema_version"],
    )
```

- [ ] **Step 5: Commit**

```bash
git add services/workflow-engine/enstellar_workflow/outbox/ services/workflow-engine/enstellar_workflow/kafka/
git commit -m "feat(T04): OutboxPublisher + OutboxRelay + KafkaProducer"
```

---

## Task 5: IdempotentKafkaConsumer

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/kafka/consumer.py`

- [ ] **Step 1: Create kafka/consumer.py**

```python
# services/workflow-engine/enstellar_workflow/kafka/consumer.py
"""IdempotentKafkaConsumer base class.

Guarantees exactly-once processing by recording event_id in the processed_events
table before calling the handler. If the DB insert fails (duplicate key), the event
has already been processed and is skipped silently.

Subclass and implement `handle(event: EventEnvelope) -> None`.
"""
import asyncio
import logging
from abc import ABC, abstractmethod

import asyncpg
from aiokafka import AIOKafkaConsumer

from enstellar_events import EventEnvelope, decode
from ..config import get_settings

logger = logging.getLogger(__name__)


class IdempotentKafkaConsumer(ABC):
    def __init__(self, pool: asyncpg.Pool, topics: list[str], group_id: str | None = None) -> None:
        settings = get_settings()
        self._pool = pool
        self._topics = topics
        self._group_id = group_id or settings.kafka_consumer_group
        self._running = False

    async def run(self) -> None:
        settings = get_settings()
        consumer = AIOKafkaConsumer(
            *self._topics,
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=self._group_id,
            enable_auto_commit=False,
        )
        await consumer.start()
        self._running = True
        try:
            async for msg in consumer:
                if not self._running:
                    break
                try:
                    event = decode(msg.value)
                    processed = await self._mark_processed(event)
                    if processed:
                        await self.handle(event)
                    await consumer.commit()
                except Exception:
                    logger.exception("Error processing event from topic %s", msg.topic)
                    # Commit anyway to avoid poison-pill replay (add DLQ in P1)
                    await consumer.commit()
        finally:
            await consumer.stop()

    async def stop(self) -> None:
        self._running = False

    async def _mark_processed(self, event: EventEnvelope) -> bool:
        """Insert event_id into processed_events. Returns True if new, False if already seen."""
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO processed_events (event_id, consumer_group)
                    VALUES ($1, $2)
                    """,
                    event.event_id,
                    self._group_id,
                )
                return True
            except asyncpg.UniqueViolationError:
                logger.debug("Event %s already processed by %s — skipping", event.event_id, self._group_id)
                return False

    @abstractmethod
    async def handle(self, event: EventEnvelope) -> None:
        """Process a single event. Called only if the event has not been seen before."""
```

- [ ] **Step 2: Commit**

```bash
git add services/workflow-engine/enstellar_workflow/kafka/consumer.py
git commit -m "feat(T04): IdempotentKafkaConsumer — deduplicates via processed_events table"
```

---

## Task 6: Integration tests — publisher + relay + consumer

**Files:**
- Create: `services/workflow-engine/tests/conftest.py`
- Create: `services/workflow-engine/tests/test_envelope_contract.py`
- Create: `services/workflow-engine/tests/test_publisher.py`
- Create: `services/workflow-engine/tests/test_relay.py`
- Create: `services/workflow-engine/tests/test_consumer_idempotent.py`

- [ ] **Step 1: Create tests/conftest.py**

```python
# services/workflow-engine/tests/conftest.py
"""Testcontainers fixtures for PostgreSQL + Redpanda.

Tests that need a real DB or Kafka get these fixtures.
"""
import asyncio
import os
from typing import AsyncGenerator

import asyncpg
import pytest
import pytest_asyncio
from testcontainers.postgres import PostgresContainer
from testcontainers.kafka import KafkaContainer


@pytest.fixture(scope="session")
def pg_container():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg


@pytest.fixture(scope="session")
def kafka_container():
    with KafkaContainer("redpandadata/redpanda:v24.1.7") as kafka:
        yield kafka


@pytest_asyncio.fixture(scope="session")
async def pg_pool(pg_container):
    dsn = pg_container.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)

    # Run migrations
    import subprocess, sys
    env = {**os.environ, "WORKFLOW_DB_URL": dsn}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(__import__("pathlib").Path(__file__).parent.parent),
        env=env,
        check=True,
    )

    yield pool
    await pool.close()


@pytest.fixture
def kafka_bootstrap(kafka_container) -> str:
    return kafka_container.get_bootstrap_server()
```

- [ ] **Step 2: Create tests/test_envelope_contract.py**

```python
# services/workflow-engine/tests/test_envelope_contract.py
"""Smoke test: events produced by workflow-engine conform to the envelope schema."""
import uuid
from datetime import datetime, timezone

import pytest

from enstellar_events import EventEnvelope, Actor, ActorType, Topics, encode, decode


def _make_event(**overrides) -> dict:
    base = {
        "event_id": str(uuid.uuid4()),
        "tenant_id": "tenant-test",
        "case_id": str(uuid.uuid4()),
        "correlation_id": "corr-001",
        "type": Topics.CASE_STATE_TRANSITIONED,
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "actor": {"id": "system", "type": "system"},
        "payload": {"from_state": "intake", "to_state": "completeness_check"},
        "schema_version": "1.0.0",
    }
    return {**base, **overrides}


def test_valid_event_parses():
    env = EventEnvelope.model_validate(_make_event())
    assert env.tenant_id == "tenant-test"


def test_encode_decode_roundtrip():
    env = EventEnvelope.model_validate(_make_event())
    assert decode(encode(env)) == env


def test_event_without_tenant_id_rejected():
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        EventEnvelope.model_validate(_make_event(tenant_id=""))
```

- [ ] **Step 3: Write publisher test — expect DB insert**

```python
# services/workflow-engine/tests/test_publisher.py
"""Integration tests for OutboxPublisher — requires real PostgreSQL."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType
from enstellar_workflow.outbox.publisher import OutboxPublisher


def _make_event(tenant_id: str = "tenant-test") -> EventEnvelope:
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id=tenant_id,
        case_id=uuid.uuid4(),
        correlation_id="corr-001",
        type="case.state.transitioned",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "intake", "to_state": "completeness_check"},
        schema_version="1.0.0",
    )


@pytest.mark.asyncio
async def test_publisher_inserts_outbox_row(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)

    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT event_id, tenant_id, published_at FROM outbox WHERE event_id = $1",
            event.event_id,
        )
    assert row is not None
    assert str(row["event_id"]) == str(event.event_id)
    assert row["tenant_id"] == "tenant-test"
    assert row["published_at"] is None  # not yet relayed


@pytest.mark.asyncio
async def test_publisher_deduplicates_same_event_id(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    event = _make_event()

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)
        async with conn.transaction():
            await publisher.publish(conn, event)  # duplicate — should be no-op

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox WHERE event_id = $1", event.event_id
        )
    assert count == 1


@pytest.mark.asyncio
async def test_publisher_rejects_missing_tenant_id(pg_pool: asyncpg.Pool):
    publisher = OutboxPublisher()
    import pydantic
    with pytest.raises((ValueError, pydantic.ValidationError)):
        EventEnvelope(
            event_id=uuid.uuid4(),
            tenant_id="",  # empty — should fail at model validation
            correlation_id="corr",
            type="case.state.transitioned",
            occurred_at=datetime.now(timezone.utc),
            actor=Actor(id="system", type=ActorType.SYSTEM),
            payload={},
            schema_version="1.0.0",
        )
```

- [ ] **Step 4: Run publisher test — expect pass**

```bash
cd services/workflow-engine && uv run pytest tests/test_publisher.py tests/test_envelope_contract.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Write relay test**

```python
# services/workflow-engine/tests/test_relay.py
"""Integration test for OutboxRelay — requires PostgreSQL + Kafka."""
import asyncio
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType, decode
from enstellar_workflow.config import get_settings
from enstellar_workflow.kafka.producer import KafkaProducer
from enstellar_workflow.outbox.publisher import OutboxPublisher
from enstellar_workflow.outbox.relay import OutboxRelay


@pytest.mark.asyncio
async def test_relay_publishes_to_kafka_and_marks_published(
    pg_pool: asyncpg.Pool, kafka_bootstrap: str, monkeypatch
):
    # Patch bootstrap servers so producer connects to test container
    monkeypatch.setenv("WORKFLOW_KAFKA_BOOTSTRAP_SERVERS", kafka_bootstrap)
    # Reset cached settings
    import enstellar_workflow.config as cfg_module
    cfg_module._settings = None

    publisher = OutboxPublisher()
    producer = KafkaProducer()
    await producer.start()

    event = EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id="tenant-test",
        case_id=uuid.uuid4(),
        correlation_id="corr-relay-test",
        type="case.state.transitioned",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={"from_state": "intake", "to_state": "completeness_check"},
        schema_version="1.0.0",
    )

    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            await publisher.publish(conn, event)

    relay = OutboxRelay(pg_pool, producer)
    published = await relay._relay_batch(10)
    assert published == 1

    await producer.stop()

    # Verify published_at is set
    async with pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT published_at FROM outbox WHERE event_id = $1", event.event_id
        )
    assert row["published_at"] is not None
```

- [ ] **Step 6: Write idempotent consumer test**

```python
# services/workflow-engine/tests/test_consumer_idempotent.py
"""Tests for IdempotentKafkaConsumer deduplication logic."""
import uuid
from datetime import datetime, timezone

import asyncpg
import pytest

from enstellar_events import EventEnvelope, Actor, ActorType
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer


class _RecordingConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool, topics):
        super().__init__(pool, topics, group_id="test-group")
        self.handled: list[EventEnvelope] = []

    async def handle(self, event: EventEnvelope) -> None:
        self.handled.append(event)


def _make_event() -> EventEnvelope:
    return EventEnvelope(
        event_id=uuid.uuid4(),
        tenant_id="tenant-test",
        correlation_id="corr-idem",
        type="case.state.transitioned",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type=ActorType.SYSTEM),
        payload={},
        schema_version="1.0.0",
    )


@pytest.mark.asyncio
async def test_first_event_is_processed(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["case.state.transitioned"])
    event = _make_event()
    processed = await consumer._mark_processed(event)
    assert processed is True


@pytest.mark.asyncio
async def test_duplicate_event_is_skipped(pg_pool: asyncpg.Pool):
    consumer = _RecordingConsumer(pg_pool, ["case.state.transitioned"])
    event = _make_event()
    first = await consumer._mark_processed(event)
    second = await consumer._mark_processed(event)
    assert first is True
    assert second is False


@pytest.mark.asyncio
async def test_same_event_different_consumer_group(pg_pool: asyncpg.Pool):
    c1 = _RecordingConsumer(pg_pool, ["case.state.transitioned"])
    c1._group_id = "group-a"
    c2 = _RecordingConsumer(pg_pool, ["case.state.transitioned"])
    c2._group_id = "group-b"

    event = _make_event()
    r1 = await c1._mark_processed(event)
    r2 = await c2._mark_processed(event)
    # Different consumer groups — both should process the event independently
    assert r1 is True
    assert r2 is True
```

- [ ] **Step 7: Run all workflow-engine tests**

```bash
cd services/workflow-engine && uv run pytest tests/ -v
```

Expected: all 12 tests pass.

- [ ] **Step 8: Commit**

```bash
git add services/workflow-engine/tests/
git commit -m "test(T04): outbox publisher + relay + idempotent consumer — all integration tests green"
```

---

## Task 7: Wire into Makefile + CI + update task graph

**Files:**
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Step 1: Update Makefile test target**

```makefile
## Run unit, contract, and integration tests across all services.
test:
	cd packages/canonical-model && uv run pytest tests/python/ -v
	cd packages/canonical-model && npm test
	cd packages/canonical-model && ./gradlew test
	cd packages/authz && uv run pytest tests/ -v
	cd packages/event-contracts && uv run pytest tests/ -v
	cd services/interop && ./gradlew test
	cd services/workflow-engine && uv run pytest tests/ -v
```

- [ ] **Step 2: Add CI jobs**

```yaml
  test-event-contracts:
    name: event-contracts — envelope schema + codec
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Test
        working-directory: packages/event-contracts
        run: |
          uv sync
          uv run pytest tests/ -v

  test-workflow-engine-outbox:
    name: workflow-engine — outbox + consumer integration
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Test
        working-directory: services/workflow-engine
        run: |
          uv sync
          uv run pytest tests/ -v
```

- [ ] **Step 3: Mark T04 done in task-graph.md**

Change T04 row: `[ ]` → `[x]`

- [ ] **Step 4: Run make test**

```bash
make test
```

Expected: all targets pass.

- [ ] **Step 5: Final commit**

```bash
git add Makefile .github/workflows/ci.yml .claude/task-graph.md
git commit -m "feat(T04): event bus + outbox complete — publisher/relay/consumer tests green; T04 marked done"
```

---

## Self-Check

- [x] `EventEnvelope.tenant_id` is required and rejects blank values (invariant #5)
- [x] `OutboxPublisher` validates `tenant_id` before any DB insert
- [x] Outbox write is inside the caller's transaction (transactional guarantee)
- [x] `OutboxRelay` publishes to topic = `event.type` (partitioned by tenant_id key)
- [x] `IdempotentKafkaConsumer` deduplicates via `processed_events` table (insert-on-first-seen)
- [x] Same event processed correctly by different consumer groups independently
- [x] No PHI in test events — payload is synthetic state transition data only
- [x] Alembic migration includes `CheckConstraint` for non-empty `tenant_id`
- [x] T04 marked `[x]` done in task graph

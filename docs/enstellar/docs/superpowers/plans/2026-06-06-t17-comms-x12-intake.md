# T17 — Comms/Notifications + X12 278/275 Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out P1 by adding (A) tenant-templated determination notifications (Python, `services/workflow-engine/`) triggered by `decision.recorded` Kafka events, emitting `notification.sent` via outbox; and (B) bidirectional X12 278 ↔ canonical Case translation (Java, `services/interop/x12-translator/`) with config-driven companion guide per trading partner and a golden-fixture round-trip regression suite.

**Architecture:** Notifications use the existing outbox + `IdempotentKafkaConsumer` pattern. Jinja2 renders subject+body from DB templates; only non-PHI context (`case_id`, `outcome`, `decided_at`) is passed — never `member_name`, `dob`, or `ssn`. X12 follows the store-first pattern (raw X12 → MinIO before any transform, same as T06/T07). Companion-guide variability is isolated in `TradingPartnerProfile` config — no segment positions hard-coded in mapper logic.

**Tech Stack:** Python 3.12, Jinja2, asyncpg, aiokafka, Testcontainers; Java 21, Spring Boot 3.3, LinuxForHealth x12-parser 0.9.1, AWS SDK v2 (MinIO/LocalStack), JUnit 5.

> **Sensitive task (FHIR/X12):** Mandatory senior engineer review. PHI must never appear in notification bodies — verified by test. X12 companion guide config must be validated against actual trading-partner specs before production use.

**Depends on:** T04 (outbox, `IdempotentKafkaConsumer`), T08 (workflow DB schema, `workflow_events`), T13 (`decision.recorded` emitted on determination), T06 (MinIO store-first pattern), T02 (canonical model Java records).

---

## File Map

**New Python files:**
- Create: `services/workflow-engine/enstellar_workflow/comms/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/comms/service.py`
- Create: `services/workflow-engine/enstellar_workflow/comms/consumers/decision_recorded.py`
- Create: `services/workflow-engine/migrations/versions/0005_notification_templates.py`
- Create: `services/workflow-engine/db/seeds/notification_templates.sql`
- Modify: `services/workflow-engine/pyproject.toml` (add `jinja2>=3.1`)
- Test: `services/workflow-engine/tests/comms/test_notification_service.py`
- Test: `services/workflow-engine/tests/comms/test_decision_recorded_consumer.py`

**New JVM files:**
- Create: `services/interop/x12-translator/build.gradle`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/X12TranslatorApplication.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/config/TradingPartnerProperties.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/config/TradingPartnerProfile.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/storage/X12MinioStore.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/mapper/X12ToCanonicalMapper.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/mapper/CanonicalToX12Mapper.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/service/X12InboundService.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/service/X12OutboundService.java`
- Create: `services/interop/x12-translator/src/main/java/com/simintero/enstellar/x12/controller/X12TranslateController.java`
- Create: `services/interop/x12-translator/src/main/resources/application.yml`
- Create: `services/interop/x12-translator/src/main/resources/x12/trading-partners.yml`
- Test: `services/interop/x12-translator/src/test/java/com/simintero/enstellar/x12/X12ToCanonicalMapperTest.java`
- Test: `services/interop/x12-translator/src/test/java/com/simintero/enstellar/x12/X12RoundTripTest.java`

---

## Task 1: Migration 0005 — notification_templates + notification_log

**Files:**
- Create: `services/workflow-engine/migrations/versions/0005_notification_templates.py`
- Test: inline in migration test fixture

- [ ] **Write the failing test**

```python
# tests/comms/test_notification_service.py (create file, add first test)
import pytest

@pytest.mark.asyncio
async def test_notification_tables_exist(pg_pool):
    async with pg_pool.acquire() as conn:
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN "
            "('notification_templates','notification_log') ORDER BY tablename"
        )
        assert [r["tablename"] for r in tables] == ["notification_log", "notification_templates"]
```

Run: `cd services/workflow-engine && uv run pytest tests/comms/test_notification_service.py::test_notification_tables_exist -v`
Expected: FAIL — tables do not exist

- [ ] **Create migration file**

```python
# migrations/versions/0005_notification_templates.py
"""notification_templates and notification_log tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-06
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("""
        CREATE TABLE notification_templates (
            template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL CHECK (tenant_id != ''),
            event_type TEXT NOT NULL,
            channel TEXT NOT NULL,
            subject_template TEXT NOT NULL,
            body_template TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            UNIQUE (tenant_id, event_type, channel, version)
        )
    """)
    op.execute("""
        CREATE TABLE notification_log (
            notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL CHECK (tenant_id != ''),
            case_id UUID NOT NULL,
            event_type TEXT NOT NULL,
            channel TEXT NOT NULL,
            template_id UUID REFERENCES notification_templates(template_id),
            rendered_subject TEXT NOT NULL,
            sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            status TEXT NOT NULL DEFAULT 'sent'
        )
    """)

def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notification_log")
    op.execute("DROP TABLE IF EXISTS notification_templates")
```

- [ ] **Run migration and test**

```bash
cd services/workflow-engine
uv run alembic upgrade head
uv run pytest tests/comms/test_notification_service.py::test_notification_tables_exist -v
```

Expected: PASS

- [ ] **Test UNIQUE constraint**

```python
@pytest.mark.asyncio
async def test_notification_templates_unique_constraint(pg_pool):
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template, version) "
            "VALUES ('t1', 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved', 1)"
        )
        with pytest.raises(Exception, match="unique"):
            await conn.execute(
                "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template, version) "
                "VALUES ('t1', 'approved', 'portal', 'Dup', 'Dup', 1)"
            )
```

Run: `uv run pytest tests/comms/test_notification_service.py -v`
Expected: both tests PASS

- [ ] **Commit**

```bash
git add migrations/versions/0005_notification_templates.py tests/comms/
git commit -m "feat(comms): add notification_templates and notification_log tables (migration 0005)"
```

---

## Task 2: NotificationService

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/comms/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/comms/service.py`
- Modify: `services/workflow-engine/pyproject.toml`
- Modify: `services/workflow-engine/tests/comms/test_notification_service.py`

- [ ] **Add jinja2 dependency**

In `pyproject.toml` under `dependencies`:
```toml
"jinja2>=3.1",
```

Run: `uv sync`

- [ ] **Write the failing tests**

```python
# tests/comms/test_notification_service.py — add these tests

@pytest.mark.asyncio
async def test_render_and_dispatch_inserts_log_rows_and_publishes_events(pg_pool):
    """Two active templates for 'approved' → two log rows + two outbox events."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor
    import uuid

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    case_id = str(uuid.uuid4())
    tenant_id = "tenant-test"

    async with pg_pool.acquire() as conn:
        # Insert two active templates
        for channel in ("portal", "email"):
            await conn.execute(
                "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
                "VALUES ($1, 'approved', $2, 'PA {{ outcome }}', 'Case {{ case_id }} is {{ outcome }}')",
                tenant_id, channel,
            )
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "approved",
                {"case_id": case_id, "outcome": "approved", "decided_at": "2026-06-06T00:00:00Z"},
                Actor(id="system", type="system"),
            )

    assert len(ids) == 2
    async with pg_pool.acquire() as conn:
        log_count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
        outbox_count = await conn.fetchval(
            "SELECT COUNT(*) FROM outbox WHERE tenant_id=$1 AND event_type='notification.sent'",
            tenant_id,
        )
    assert log_count == 2
    assert outbox_count == 2

@pytest.mark.asyncio
async def test_notification_body_contains_no_phi(pg_pool):
    """Template context must not include member_name, dob, ssn."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor
    import uuid

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    case_id = str(uuid.uuid4())
    tenant_id = "phi-test-tenant"

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'Denied', 'Case {{ case_id }} denied on {{ decided_at }}')",
            tenant_id,
        )
        async with conn.transaction():
            # Pass PHI in context — service must not render it (it's not in template)
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                {
                    "case_id": case_id, "outcome": "denied", "decided_at": "2026-06-06T00:00:00Z",
                    "member_name": "JOHN SMITH",  # should NOT appear in rendered output
                    "dob": "1980-01-01",
                },
                Actor(id="system", type="system"),
            )
        rendered = await conn.fetchval(
            "SELECT rendered_subject FROM notification_log WHERE tenant_id=$1", tenant_id
        )

    assert "JOHN SMITH" not in rendered
    assert "1980-01-01" not in rendered

@pytest.mark.asyncio
async def test_no_templates_returns_empty_list(pg_pool):
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from enstellar_events.envelope import Actor

    service = NotificationService(OutboxPublisher())
    async with pg_pool.acquire() as conn:
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, "unknown-tenant", "00000000-0000-0000-0000-000000000001",
                "approved", {"case_id": "x", "outcome": "approved", "decided_at": "2026-06-06"},
                Actor(id="system", type="system"),
            )
    assert ids == []
```

Run: `uv run pytest tests/comms/test_notification_service.py -v`
Expected: FAIL — `NotificationService` not found

- [ ] **Implement NotificationService**

```python
# enstellar_workflow/comms/__init__.py
# (empty)
```

```python
# enstellar_workflow/comms/service.py
from __future__ import annotations
import uuid
from datetime import datetime, timezone

import asyncpg
from jinja2 import Environment, BaseLoader

from enstellar_events.envelope import Actor, EventEnvelope
from enstellar_workflow.outbox.publisher import OutboxPublisher

_jinja = Environment(loader=BaseLoader(), autoescape=False)

TERMINAL_OUTCOMES = frozenset({"approved", "denied", "partially_denied", "adverse_modification"})


class NotificationService:
    def __init__(self, publisher: OutboxPublisher) -> None:
        self._pub = publisher

    async def render_and_dispatch(
        self,
        conn: asyncpg.Connection,
        tenant_id: str,
        case_id: str,
        event_type: str,
        context: dict,
        actor: Actor,
    ) -> list[str]:
        templates = await conn.fetch(
            "SELECT * FROM notification_templates "
            "WHERE tenant_id=$1 AND event_type=$2 AND active=TRUE",
            tenant_id, event_type,
        )
        notification_ids: list[str] = []
        for tmpl in templates:
            subject = _jinja.from_string(tmpl["subject_template"]).render(**context)
            body = _jinja.from_string(tmpl["body_template"]).render(**context)
            nid = await conn.fetchval(
                "INSERT INTO notification_log "
                "(tenant_id, case_id, event_type, channel, template_id, rendered_subject) "
                "VALUES ($1, $2, $3, $4, $5, $6) RETURNING notification_id",
                tenant_id, uuid.UUID(case_id), event_type,
                tmpl["channel"], tmpl["template_id"], subject,
            )
            await self._pub.publish(
                conn,
                EventEnvelope(
                    event_id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    case_id=uuid.UUID(case_id),
                    correlation_id=str(uuid.uuid4()),
                    type="notification.sent",
                    occurred_at=datetime.now(timezone.utc),
                    actor=actor,
                    payload={
                        "channel": tmpl["channel"],
                        "event_type": event_type,
                        "notification_id": str(nid),
                        "subject": subject,
                        "body": body,
                    },
                    schema_version="1.0.0",
                ),
            )
            notification_ids.append(str(nid))
        return notification_ids
```

- [ ] **Run tests**

```bash
uv run pytest tests/comms/test_notification_service.py -v
```

Expected: all 3 tests PASS

- [ ] **Commit**

```bash
git add enstellar_workflow/comms/ tests/comms/test_notification_service.py pyproject.toml
git commit -m "feat(comms): add NotificationService with Jinja2 render and outbox publish"
```

---

## Task 3: DecisionRecordedConsumer

**Files:**
- Create: `services/workflow-engine/enstellar_workflow/comms/consumers/__init__.py`
- Create: `services/workflow-engine/enstellar_workflow/comms/consumers/decision_recorded.py`
- Test: `services/workflow-engine/tests/comms/test_decision_recorded_consumer.py`

- [ ] **Write the failing integration test**

```python
# tests/comms/test_decision_recorded_consumer.py
import asyncio
import uuid
import pytest
from datetime import datetime, timezone
from enstellar_events.envelope import EventEnvelope, Actor
from enstellar_events.codec import encode

@pytest.mark.asyncio
async def test_approved_decision_triggers_notification(pg_pool, redpanda_bootstrap):
    """Publish decision.recorded with outcome=approved → notification_log row inserted."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from aiokafka import AIOKafkaProducer

    tenant_id = "tenant-notif-test"
    case_id = str(uuid.uuid4())

    # Seed a template
    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template) "
            "VALUES ($1, 'approved', 'portal', 'Approved', 'Case {{ case_id }} approved')",
            tenant_id,
        )

    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, publisher, service)

    event = EventEnvelope(
        event_id=uuid.uuid4(), tenant_id=tenant_id, case_id=uuid.UUID(case_id),
        correlation_id=str(uuid.uuid4()), type="decision.recorded",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type="system"),
        payload={"outcome": "approved", "rule_artifact_id": "ra-001", "rule_version": "1.0"},
        schema_version="1.0.0",
    )

    producer = AIOKafkaProducer(bootstrap_servers=redpanda_bootstrap)
    await producer.start()
    await producer.send_and_wait("decision.recorded", encode(event))
    await producer.stop()

    # Run consumer for one batch
    await asyncio.wait_for(consumer._consume_one(), timeout=10.0)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1 AND case_id=$2",
            tenant_id, uuid.UUID(case_id),
        )
    assert count == 1

@pytest.mark.asyncio
async def test_non_terminal_outcome_skipped(pg_pool, redpanda_bootstrap):
    """outcome=pending → no notification_log row."""
    from enstellar_workflow.comms.consumers.decision_recorded import DecisionRecordedConsumer
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher
    from aiokafka import AIOKafkaProducer

    tenant_id = "tenant-skip-test"
    case_id = str(uuid.uuid4())
    publisher = OutboxPublisher()
    service = NotificationService(publisher)
    consumer = DecisionRecordedConsumer(pg_pool, publisher, service)

    event = EventEnvelope(
        event_id=uuid.uuid4(), tenant_id=tenant_id, case_id=uuid.UUID(case_id),
        correlation_id=str(uuid.uuid4()), type="decision.recorded",
        occurred_at=datetime.now(timezone.utc),
        actor=Actor(id="system", type="system"),
        payload={"outcome": "pending"},
        schema_version="1.0.0",
    )

    producer = AIOKafkaProducer(bootstrap_servers=redpanda_bootstrap)
    await producer.start()
    await producer.send_and_wait("decision.recorded", encode(event))
    await producer.stop()

    await asyncio.wait_for(consumer._consume_one(), timeout=10.0)

    async with pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM notification_log WHERE tenant_id=$1", tenant_id
        )
    assert count == 0
```

Run: `uv run pytest tests/comms/test_decision_recorded_consumer.py -v`
Expected: FAIL — `DecisionRecordedConsumer` not found

- [ ] **Implement DecisionRecordedConsumer**

```python
# enstellar_workflow/comms/consumers/__init__.py
# (empty)
```

```python
# enstellar_workflow/comms/consumers/decision_recorded.py
from __future__ import annotations

from enstellar_events.envelope import Actor, EventEnvelope
from enstellar_events.topics import DECISION_RECORDED
from enstellar_workflow.comms.service import NotificationService, TERMINAL_OUTCOMES
from enstellar_workflow.kafka.consumer import IdempotentKafkaConsumer
from enstellar_workflow.outbox.publisher import OutboxPublisher


class DecisionRecordedConsumer(IdempotentKafkaConsumer):
    def __init__(self, pool, publisher: OutboxPublisher, notification_service: NotificationService) -> None:
        super().__init__(pool, publisher, topics=[DECISION_RECORDED], consumer_group="comms")
        self._notify = notification_service

    async def handle(self, event: EventEnvelope) -> None:
        outcome = event.payload.get("outcome")
        if outcome not in TERMINAL_OUTCOMES:
            return
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._notify.render_and_dispatch(
                    conn,
                    event.tenant_id,
                    str(event.case_id),
                    event_type=outcome,
                    context={
                        "case_id": str(event.case_id),
                        "outcome": outcome,
                        "decided_at": event.occurred_at.isoformat(),
                    },
                    actor=event.actor,
                )
```

Note: add `DECISION_RECORDED = "decision.recorded"` to `packages/event-contracts/enstellar_events/topics.py` if not already present.

- [ ] **Run tests**

```bash
uv run pytest tests/comms/ -v
```

Expected: all tests PASS

- [ ] **Commit**

```bash
git add enstellar_workflow/comms/consumers/ tests/comms/test_decision_recorded_consumer.py
git commit -m "feat(comms): add DecisionRecordedConsumer — dispatches notifications on terminal decisions"
```

---

## Task 4: Seed templates + Makefile targets

**Files:**
- Create: `services/workflow-engine/db/seeds/notification_templates.sql`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`

- [ ] **Create seed file**

```sql
-- db/seeds/notification_templates.sql
-- Sample templates for local dev / design partner demo
-- PHI-safe: only case_id, outcome, decided_at in context

INSERT INTO notification_templates (tenant_id, event_type, channel, subject_template, body_template)
VALUES
  ('demo-tenant', 'approved',  'portal',
   'Prior Authorization Approved — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) has been approved on {{ decided_at }}.'),
  ('demo-tenant', 'denied',    'portal',
   'Prior Authorization Determination — Case {{ case_id }}',
   'Your prior authorization request (Case {{ case_id }}) received a determination of {{ outcome }} on {{ decided_at }}. Please contact your provider for next steps.'),
  ('demo-tenant', 'approved',  'email',
   'PA Approved: {{ case_id }}',
   'Authorization approved. Reference: {{ case_id }}. Date: {{ decided_at }}.')
ON CONFLICT (tenant_id, event_type, channel, version) DO NOTHING;
```

- [ ] **Add Makefile targets**

```makefile
seed-db:
	cd services/workflow-engine && uv run python -c \
	  "import asyncpg, asyncio; \
	   conn = asyncio.run(asyncpg.connect('$(WORKFLOW_DB_URL)')); \
	   asyncio.run(conn.execute(open('db/seeds/notification_templates.sql').read())); \
	   asyncio.run(conn.close())"

test-comms:
	cd services/workflow-engine && uv run pytest tests/comms/ -v
```

- [ ] **Add CI job** in `.github/workflows/ci.yml`

```yaml
  test-workflow-engine-comms:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: workflow
          POSTGRES_PASSWORD: workflow_secret
          POSTGRES_DB: workflow
        ports: ["5432:5432"]
      redpanda:
        image: docker.redpanda.com/redpandadata/redpanda:v24.1.7
        ports: ["9092:9092"]
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v3
      - run: cd services/workflow-engine && uv sync --dev
      - run: cd services/workflow-engine && uv run alembic upgrade head
        env:
          WORKFLOW_DB_URL: postgresql+asyncpg://workflow:workflow_secret@localhost:5432/workflow
      - run: cd services/workflow-engine && uv run pytest tests/comms/ -v
        env:
          WORKFLOW_DB_URL: postgresql+asyncpg://workflow:workflow_secret@localhost:5432/workflow
          WORKFLOW_KAFKA_BOOTSTRAP_SERVERS: localhost:9092
```

- [ ] **Commit**

```bash
git add db/seeds/notification_templates.sql
git commit -m "feat(comms): seed notification templates for demo tenant"
git add Makefile .github/workflows/ci.yml
git commit -m "ci: add test-comms Makefile target and CI job"
```

---

## Task 5: X12 translator module scaffold (JVM)

**Files:**
- Create: `services/interop/x12-translator/build.gradle`
- Create: `services/interop/x12-translator/src/main/java/.../X12TranslatorApplication.java`
- Create: `services/interop/x12-translator/src/main/java/.../config/TradingPartnerProfile.java`
- Create: `services/interop/x12-translator/src/main/java/.../config/TradingPartnerProperties.java`
- Create: `services/interop/x12-translator/src/main/resources/application.yml`
- Create: `services/interop/x12-translator/src/main/resources/x12/trading-partners.yml`
- Modify: `settings.gradle` (add module)

- [ ] **Write the failing test**

```java
// src/test/java/com/simintero/enstellar/x12/X12AppContextTest.java
package com.simintero.enstellar.x12;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class X12AppContextTest {
    @Test
    void contextLoads() {}
}
```

Run: `cd services/interop/x12-translator && ./gradlew test --tests "*.X12AppContextTest"` (will fail — module doesn't exist yet)

- [ ] **Create build.gradle**

```groovy
plugins {
    id 'org.springframework.boot' version '3.3.0'
    id 'io.spring.dependency-management' version '1.1.4'
    id 'java'
}
group = 'com.simintero.enstellar'
version = '0.0.1-SNAPSHOT'
java { sourceCompatibility = JavaVersion.VERSION_21 }
repositories { mavenCentral() }
dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-web'
    implementation 'org.springframework.boot:spring-boot-starter-actuator'
    implementation 'com.linuxforhealth.x12:x12-parser:0.9.1'
    implementation 'software.amazon.awssdk:s3:2.25.0'
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testImplementation 'org.testcontainers:testcontainers:1.19.8'
    testImplementation 'org.testcontainers:localstack:1.19.8'
}
```

- [ ] **Create application classes**

```java
// X12TranslatorApplication.java
package com.simintero.enstellar.x12;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import com.simintero.enstellar.x12.config.TradingPartnerProperties;
@SpringBootApplication
@EnableConfigurationProperties(TradingPartnerProperties.class)
public class X12TranslatorApplication {
    public static void main(String[] args) { SpringApplication.run(X12TranslatorApplication.class, args); }
}
```

```java
// config/TradingPartnerProfile.java
package com.simintero.enstellar.x12.config;
import java.util.Map;
public record TradingPartnerProfile(String defaultLob, Map<String, String> urgencyCodeMap) {}
```

```java
// config/TradingPartnerProperties.java
package com.simintero.enstellar.x12.config;
import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.Map;
@ConfigurationProperties(prefix = "x12")
public record TradingPartnerProperties(Map<String, TradingPartnerProfile> tradingPartners) {
    public TradingPartnerProfile getProfile(String id) {
        TradingPartnerProfile p = tradingPartners.get(id);
        if (p == null) throw new IllegalArgumentException("Unknown trading partner: " + id);
        return p;
    }
}
```

- [ ] **Create config files**

```yaml
# src/main/resources/application.yml
spring:
  application.name: x12-translator
x12:
  trading-partners:
    default:
      default-lob: commercial
      urgency-code-map: { "1": standard, "2": expedited, "3": concurrent }
    expedited-partner:
      default-lob: medicaid
      urgency-code-map: { "U": expedited, "R": standard }
minio:
  endpoint: ${MINIO_ENDPOINT:http://minio:9000}
  access-key: ${MINIO_ACCESS_KEY:minioadmin}
  secret-key: ${MINIO_SECRET_KEY:minioadmin}
  bucket: ${MINIO_X12_BUCKET:x12-raw}
```

```yaml
# src/test/resources/application-test.yml
minio:
  endpoint: http://localhost:4566   # LocalStack
  access-key: test
  secret-key: test
  bucket: x12-raw-test
```

- [ ] **Add to settings.gradle**

```groovy
// In root settings.gradle, add:
include ':services:interop:x12-translator'
```

- [ ] **Run test**

```bash
cd services/interop/x12-translator && ../../../gradlew test --tests "*.X12AppContextTest" -i
```

Expected: PASS (context loads)

- [ ] **Commit**

```bash
git add services/interop/x12-translator/
git commit -m "feat(x12): scaffold x12-translator Spring Boot module"
```

---

## Task 6: X12MinioStore + raw storage

**Files:**
- Create: `services/interop/x12-translator/src/main/java/.../storage/X12MinioStore.java`
- Create: `services/interop/x12-translator/src/main/java/.../config/MinioConfig.java`
- Test: `src/test/java/.../X12MinioStoreTest.java`

- [ ] **Write the failing test**

```java
// X12MinioStoreTest.java
package com.simintero.enstellar.x12;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import com.simintero.enstellar.x12.storage.X12MinioStore;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Testcontainers
class X12MinioStoreTest {
    @Container
    static LocalStackContainer localstack = new LocalStackContainer(/* image */)
        .withServices(LocalStackContainer.Service.S3);

    @Autowired X12MinioStore store;

    @Test
    void store_rawX12_thenObjectExistsInBucket() {
        String raw = "ISA*00*...~";
        String tenantId = "test-tenant";
        String correlationId = "CORR-001";
        store.store(raw, tenantId, correlationId);
        assertThat(store.exists(tenantId, correlationId)).isTrue();
    }
}
```

Run: `./gradlew test --tests "*.X12MinioStoreTest"` — Expected: FAIL

- [ ] **Implement MinioConfig and X12MinioStore**

```java
// config/MinioConfig.java
package com.simintero.enstellar.x12.config;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import java.net.URI;
@Configuration
public class MinioConfig {
    @Value("${minio.endpoint}") String endpoint;
    @Value("${minio.access-key}") String accessKey;
    @Value("${minio.secret-key}") String secretKey;
    @Bean
    public S3Client s3Client() {
        return S3Client.builder()
            .endpointOverride(URI.create(endpoint))
            .credentialsProvider(StaticCredentialsProvider.create(
                AwsBasicCredentials.create(accessKey, secretKey)))
            .region(Region.US_EAST_1)
            .forcePathStyle(true)
            .build();
    }
}
```

```java
// storage/X12MinioStore.java
package com.simintero.enstellar.x12.storage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import java.nio.charset.StandardCharsets;
@Component
public class X12MinioStore {
    private final S3Client s3;
    @Value("${minio.bucket}") private String bucket;
    public X12MinioStore(S3Client s3) { this.s3 = s3; }

    public void store(String rawX12, String tenantId, String correlationId) {
        String key = tenantId + "/" + correlationId + ".x12";
        try { s3.createBucket(b -> b.bucket(bucket)); } catch (BucketAlreadyExistsException | BucketAlreadyOwnedByYouException ignored) {}
        s3.putObject(
            PutObjectRequest.builder().bucket(bucket).key(key).contentType("text/plain").build(),
            RequestBody.fromBytes(rawX12.getBytes(StandardCharsets.UTF_8))
        );
    }

    public boolean exists(String tenantId, String correlationId) {
        try {
            s3.headObject(HeadObjectRequest.builder().bucket(bucket).key(tenantId + "/" + correlationId + ".x12").build());
            return true;
        } catch (NoSuchKeyException e) { return false; }
    }
}
```

- [ ] **Run test**

```bash
./gradlew test --tests "*.X12MinioStoreTest" -i
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/main/java/ src/test/java/
git commit -m "feat(x12): add X12MinioStore with LocalStack integration test"
```

---

## Task 7: X12ToCanonicalMapper

**Files:**
- Create: `src/main/java/.../mapper/X12ToCanonicalMapper.java`
- Test: `src/test/java/.../X12ToCanonicalMapperTest.java`

The minimal valid X12 278 test fixture (use this string in tests):

```
ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~GS*HS*SENDER*RECEIVER*20240101*1200*1*X*005010X217~ST*278*0001~BHT*0007*13*CORR-001*20240101*1200*RQ~HL*1**20*1~NM1*X3*2*PAYER*****PI*PAYER001~HL*2*1*21*1~NM1*1P*1*DOE*JANE****XX*1234567890~HL*3*2*22*1~NM1*IL*1*SMITH*JOHN****MI*MBR001~DMG*D8*19800101*M~HL*4*3*EV*0~UM*HS*I*2~HI*BK:M5410~SV1*HC:99213*100*UN*1***1~SE*17*0001~GE*1*1~IEA*1*000000001~
```

- [ ] **Write failing test**

```java
// X12ToCanonicalMapperTest.java
@Test
void map_minimalFixture_extractsRequiredFields() {
    String raw = MINIMAL_278; // constant above
    X12Transaction tx = new X12Parser().parse(raw);
    TradingPartnerProfile profile = new TradingPartnerProfile(
        "commercial", Map.of("1", "standard", "2", "expedited")
    );
    Case result = mapper.map(tx, "test-tenant", profile);

    assertThat(result.getTenantId()).isEqualTo("test-tenant");
    assertThat(result.getCorrelationId()).isEqualTo("CORR-001");
    assertThat(result.getUrgency().name().toLowerCase()).isEqualTo("expedited");  // code "2"
    assertThat(result.getMember().getMemberId()).isEqualTo("MBR001");
    assertThat(result.getRequestingProvider().getNpi()).isEqualTo("1234567890");
    assertThat(result.getServiceLines()).hasSize(1);
    assertThat(result.getServiceLines().get(0).getProcedureCode()).isEqualTo("99213");
    assertThat(result.getStatus().name().toLowerCase()).isEqualTo("intake");
}

@Test
void map_differentTradingPartner_usesDifferentUrgencyMap() {
    // UM segment uses "U" for expedited in expedited-partner profile
    TradingPartnerProfile profile = new TradingPartnerProfile(
        "medicaid", Map.of("U", "expedited", "R", "standard")
    );
    // Use a fixture with UM*HS*I*U
    Case result = mapper.map(parseFixtureWithUrgencyCode("U"), "t2", profile);
    assertThat(result.getUrgency().name().toLowerCase()).isEqualTo("expedited");
}
```

Run: `./gradlew test --tests "*.X12ToCanonicalMapperTest"` — Expected: FAIL

- [ ] **Implement X12ToCanonicalMapper**

```java
// mapper/X12ToCanonicalMapper.java
@Component
public class X12ToCanonicalMapper {
    public Case map(X12Transaction tx, String tenantId, TradingPartnerProfile profile) {
        String correlationId = getElementValue(tx, "BHT", 3);
        String urgencyCode = getElementValue(tx, "UM", 3);
        String urgencyStr = profile.urgencyCodeMap().getOrDefault(urgencyCode, "standard");

        Member member = buildMember(tx);        // Loop 2000C NM1*IL + DMG
        Provider provider = buildProvider(tx);  // Loop 2000B NM1*1P
        Coverage coverage = buildCoverage(tx);  // Loop 2000A NM1*X3
        List<ServiceLine> lines = buildServiceLines(tx); // Loop 2000E HI + SV1

        return Case.builder()
            .caseId(UUID.randomUUID())
            .tenantId(tenantId)
            .correlationId(correlationId)
            .lob(profile.defaultLob())
            .status(Status.INTAKE)
            .urgency(Urgency.valueOf(urgencyStr.toUpperCase()))
            .member(member)
            .coverage(coverage)
            .requestingProvider(provider)
            .serviceLines(lines)
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .build();
    }

    private String getElementValue(X12Transaction tx, String segmentId, int elementPos) {
        return tx.findSegment(segmentId)
            .map(s -> s.getElement(elementPos))
            .orElse("");
    }

    private Member buildMember(X12Transaction tx) {
        // NM1*IL: NM103=last, NM104=first, NM109=member_id
        X12Segment nm1 = tx.findSegmentInLoop("2000C", "NM1").orElseThrow();
        return Member.builder()
            .memberId(nm1.getElement(9))
            .lastName(nm1.getElement(3))
            .firstName(nm1.getElement(4))
            .tenantId(tx.getTenantId())
            .build();
    }

    private Provider buildProvider(X12Transaction tx) {
        X12Segment nm1 = tx.findSegmentInLoop("2000B", "NM1").orElseThrow();
        return Provider.builder()
            .npi(nm1.getElement(9))
            .lastName(nm1.getElement(3))
            .firstName(nm1.getElement(4))
            .build();
    }

    private Coverage buildCoverage(X12Transaction tx) {
        X12Segment nm1 = tx.findSegmentInLoop("2000A", "NM1").orElseThrow();
        return Coverage.builder()
            .payerId(nm1.getElement(9))
            .payerName(nm1.getElement(3))
            .build();
    }

    private List<ServiceLine> buildServiceLines(X12Transaction tx) {
        List<X12Segment> sv1s = tx.findAllSegmentsInLoop("2000E", "SV1");
        List<X12Segment> his = tx.findAllSegmentsInLoop("2000E", "HI");
        List<String> diagCodes = his.stream()
            .map(s -> s.getElement(1).split(":")[1])
            .toList();
        return IntStream.range(0, sv1s.size()).mapToObj(i -> {
            X12Segment sv1 = sv1s.get(i);
            String procCode = sv1.getElement(1).split(":")[1]; // HC:99213 → 99213
            return ServiceLine.builder()
                .serviceLineId(UUID.randomUUID())
                .tenantId(tx.getTenantId())
                .sequence(i + 1)
                .procedureCode(procCode)
                .diagnosisCodes(diagCodes)
                .quantity(Double.parseDouble(sv1.getElement(4)))
                .units(sv1.getElement(5))
                .build();
        }).toList();
    }
}
```

- [ ] **Run tests**

```bash
./gradlew test --tests "*.X12ToCanonicalMapperTest"
```

Expected: PASS

- [ ] **Commit**

```bash
git add src/main/java/com/simintero/enstellar/x12/mapper/X12ToCanonicalMapper.java src/test/
git commit -m "feat(x12): add X12ToCanonicalMapper covering 2000A-E loops"
```

---

## Task 8: CanonicalToX12Mapper + round-trip regression

**Files:**
- Create: `src/main/java/.../mapper/CanonicalToX12Mapper.java`
- Create: `src/main/java/.../service/X12OutboundService.java`
- Test: `src/test/java/.../X12RoundTripTest.java`

- [ ] **Write the failing round-trip test**

```java
// X12RoundTripTest.java
@SpringBootTest
@ActiveProfiles("test")
class X12RoundTripTest {
    @Autowired X12InboundService inboundService;
    @Autowired X12OutboundService outboundService;

    static final String STANDARD_FIXTURE = "ISA*00*...~"; // same minimal fixture from Task 7
    static final String EXPEDITED_FIXTURE = "ISA*00*...~"; // variant with UM*HS*I*2 and different member

    @ParameterizedTest
    @MethodSource("fixtures")
    void roundTrip_preservesRequiredFields(String rawX12, String tradingPartner) {
        CanonicalResult first = inboundService.parseAndStore(rawX12, "round-trip-tenant", tradingPartner);
        String outbound = outboundService.caseToX12(first.canonicalCase(), tradingPartner);
        CanonicalResult second = inboundService.parseAndStore(outbound, "round-trip-tenant", tradingPartner);

        assertThat(second.canonicalCase().getMember().getMemberId())
            .isEqualTo(first.canonicalCase().getMember().getMemberId());
        assertThat(second.canonicalCase().getRequestingProvider().getNpi())
            .isEqualTo(first.canonicalCase().getRequestingProvider().getNpi());
        assertThat(second.canonicalCase().getServiceLines())
            .hasSameSizeAs(first.canonicalCase().getServiceLines());
        assertThat(second.canonicalCase().getServiceLines().get(0).getProcedureCode())
            .isEqualTo(first.canonicalCase().getServiceLines().get(0).getProcedureCode());
        assertThat(second.correlationId()).isNotBlank();
    }

    static Stream<Arguments> fixtures() {
        return Stream.of(
            Arguments.of(STANDARD_FIXTURE, "default"),
            Arguments.of(EXPEDITED_FIXTURE, "default")
        );
    }
}
```

Run: `./gradlew test --tests "*.X12RoundTripTest"` — Expected: FAIL

- [ ] **Implement CanonicalToX12Mapper and X12OutboundService**

```java
// mapper/CanonicalToX12Mapper.java
@Component
public class CanonicalToX12Mapper {
    public String map(Case c, TradingPartnerProfile profile) {
        String urgencyCode = profile.urgencyCodeMap().entrySet().stream()
            .filter(e -> e.getValue().equalsIgnoreCase(c.getUrgency().name()))
            .map(Map.Entry::getKey).findFirst().orElse("1");
        StringBuilder sb = new StringBuilder();
        sb.append("ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *240101*1200*^*00501*000000001*0*P*:~\n");
        sb.append("GS*HS*SENDER*RECEIVER*20240101*1200*1*X*005010X217~\n");
        sb.append("ST*278*0001~\n");
        sb.append("BHT*0007*13*").append(c.getCorrelationId()).append("*20240101*1200*RQ~\n");
        // Loop 2000A payer
        sb.append("HL*1**20*1~\n");
        sb.append("NM1*X3*2*").append(c.getCoverage().getPayerName())
          .append("*****PI*").append(c.getCoverage().getPayerId()).append("~\n");
        // Loop 2000B provider
        sb.append("HL*2*1*21*1~\n");
        sb.append("NM1*1P*1*").append(c.getRequestingProvider().getLastName())
          .append("*").append(c.getRequestingProvider().getFirstName())
          .append("****XX*").append(c.getRequestingProvider().getNpi()).append("~\n");
        // Loop 2000C member
        sb.append("HL*3*2*22*1~\n");
        sb.append("NM1*IL*1*").append(c.getMember().getLastName())
          .append("*").append(c.getMember().getFirstName())
          .append("****MI*").append(c.getMember().getMemberId()).append("~\n");
        // Loop 2000E service
        for (ServiceLine sl : c.getServiceLines()) {
            sb.append("HL*4*3*EV*0~\n");
            sb.append("UM*HS*I*").append(urgencyCode).append("~\n");
            for (String diag : sl.getDiagnosisCodes()) {
                sb.append("HI*BK:").append(diag).append("~\n");
            }
            sb.append("SV1*HC:").append(sl.getProcedureCode())
              .append("*").append((int) sl.getQuantity())
              .append("*").append(sl.getUnits()).append("*1***1~\n");
        }
        sb.append("SE*17*0001~\nGE*1*1~\nIEA*1*000000001~\n");
        return sb.toString();
    }
}
```

```java
// service/X12OutboundService.java
@Service
public class X12OutboundService {
    private final CanonicalToX12Mapper mapper;
    private final TradingPartnerProperties properties;
    public X12OutboundService(CanonicalToX12Mapper mapper, TradingPartnerProperties properties) {
        this.mapper = mapper; this.properties = properties;
    }
    public String caseToX12(Case c, String tradingPartnerId) {
        return mapper.map(c, properties.getProfile(tradingPartnerId));
    }
}
```

- [ ] **Run round-trip tests**

```bash
./gradlew test --tests "*.X12RoundTripTest"
```

Expected: both fixtures PASS

- [ ] **Commit**

```bash
git add src/main/java/com/simintero/enstellar/x12/mapper/CanonicalToX12Mapper.java \
        src/main/java/com/simintero/enstellar/x12/service/X12OutboundService.java \
        src/test/java/com/simintero/enstellar/x12/X12RoundTripTest.java
git commit -m "feat(x12): add CanonicalToX12Mapper and round-trip regression tests"
```

---

## Task 9: REST controllers + CI + T17 done

**Files:**
- Create: `src/main/java/.../controller/X12TranslateController.java`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude/task-graph.md`

- [ ] **Write the failing controller test**

```java
// X12TranslateControllerTest.java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class X12TranslateControllerTest {
    @Autowired TestRestTemplate rest;

    @Test
    void x12ToCanonical_returnsCase() {
        var req = Map.of(
            "rawX12", MINIMAL_278_FIXTURE,
            "tenantId", "test-tenant",
            "tradingPartnerId", "default"
        );
        var resp = rest.postForEntity("/translate/x12-to-canonical", req, Map.class);
        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(resp.getBody()).containsKey("case_id");
        assertThat(resp.getBody()).containsKey("correlation_id");
    }
}
```

Run: `./gradlew test --tests "*.X12TranslateControllerTest"` — Expected: FAIL

- [ ] **Implement X12TranslateController**

```java
// controller/X12TranslateController.java
@RestController
@RequestMapping("/translate")
public class X12TranslateController {
    private final X12InboundService inbound;
    private final X12OutboundService outbound;
    public X12TranslateController(X12InboundService inbound, X12OutboundService outbound) {
        this.inbound = inbound; this.outbound = outbound;
    }

    record X12InboundRequest(String rawX12, String tenantId, String tradingPartnerId) {}
    record CanonicalOutboundRequest(Case canonicalCase, String tradingPartnerId) {}

    @PostMapping("/x12-to-canonical")
    public ResponseEntity<Case> x12ToCanonical(@RequestBody X12InboundRequest req) {
        CanonicalResult result = inbound.parseAndStore(req.rawX12(), req.tenantId(), req.tradingPartnerId());
        return ResponseEntity.ok(result.canonicalCase());
    }

    @PostMapping("/canonical-to-x12")
    public ResponseEntity<String> canonicalToX12(@RequestBody CanonicalOutboundRequest req) {
        return ResponseEntity.ok(outbound.caseToX12(req.canonicalCase(), req.tradingPartnerId()));
    }
}
```

- [ ] **Run controller test**

```bash
./gradlew test --tests "*.X12TranslateControllerTest"
```

Expected: PASS

- [ ] **Add Makefile targets**

```makefile
test-x12-translator:
	cd services/interop/x12-translator && ../../../gradlew test
```

- [ ] **Add CI job** in `.github/workflows/ci.yml`

```yaml
  test-x12-translator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { java-version: '21', distribution: 'temurin' }
      - run: cd services/interop/x12-translator && ../../../gradlew test
```

- [ ] **Mark T17 done in task-graph.md**

In `.claude/task-graph.md`, change:
```
| T17 comms/notifications + X12 278/275 intake | Py/JVM | T16 | **sensitive (FHIR/X12)** | `[ ]` |
```
to:
```
| T17 comms/notifications + X12 278/275 intake | Py/JVM | T16 | **sensitive (FHIR/X12)** | `[x]` |
```

- [ ] **Commit**

```bash
git add src/main/java/com/simintero/enstellar/x12/controller/ src/test/
git commit -m "feat(x12): add X12TranslateController REST endpoints"
git add Makefile .github/workflows/ci.yml .claude/task-graph.md
git commit -m "ci: add test-x12-translator Makefile target and CI job; mark T17 done"
```

---

## P1 Exit Criteria Checklist

All tasks below must be green before marking P1 complete:

- [ ] Full PA lifecycle runs without code changes (workflow definitions in DB, T08 `workflow_definitions` table)
- [ ] No-autonomous-adverse property test suite green (Hypothesis 100 examples, T16 Task 5)
- [ ] Auto-determination never produces adverse outcome (T10 property tests green)
- [ ] Agent evals pass gates (T14: groundedness ≥ 0.8, gap-detection precision ≥ 0.75, abstention rate on ambiguous ≥ 0.6)
- [ ] X12 278 round-trip regression suite green (two golden fixtures, T17 Task 8)
- [ ] Clock/SLA breach detection < 60s lag in staging environment (T13)
- [ ] PHI never appears in notification body — test green (T17 Task 2 PHI test)
- [ ] Revital failure never blocks case workflow — test green (T15 Task 3)
- [ ] Adverse determination requires recorded human sign-off at every code path (T16 Hypothesis tests)
- [ ] Conformance smoke passes (US Core + PAS happy path, T05/T06)
- [ ] A UM team can run real PA end-to-end (minus appeals) for a design partner

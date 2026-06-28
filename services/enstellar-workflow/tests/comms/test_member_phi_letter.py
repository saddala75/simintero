"""B4 — member_phi notice render path.

A member_phi template renders WITH member PHI, stores the letter in MinIO, and the
NOTIFICATION_SENT event carries ONLY a body_ref (PHI off the event plane). Non-PHI
templates are unchanged. No real MinIO — upload_notice is monkeypatched.
"""
import json
import uuid

import pytest

from simintero_outbox import SchemaRef

import enstellar_workflow.comms.service as comms_service


async def _envelope_for_case(conn, case_id):
    env = await conn.fetchval(
        "SELECT envelope FROM shared.outbox "
        "WHERE envelope->>'schema_ref'=$1 "
        "AND envelope->'payload'->>'case_id'=$2",
        SchemaRef.NOTIFICATION_SENT, str(case_id),
    )
    if isinstance(env, str):
        env = json.loads(env)
    return env


@pytest.mark.asyncio
async def test_member_phi_letter_stored_in_minio_phi_off_event(pg_pool, monkeypatch):
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    uploads: list[tuple] = []

    def _fake_upload(self, tenant_id, notification_id, body):
        uploads.append((tenant_id, notification_id, body))
        return f"{self._bucket}/{tenant_id}/notices/{notification_id}.txt"

    monkeypatch.setattr(comms_service.MinioStore, "upload_notice", _fake_upload)

    service = NotificationService(OutboxPublisher())
    tenant_id = f"phi-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, member_phi, subject_template, body_template) "
            "VALUES ($1, 'denied', 'mail', 'ma', TRUE, 'Determination for {{ member_name }}', "
            "'Dear {{ member_name }} (DOB {{ dob }}): {{ outcome }}. "
            "Appeal within {{ appeal_deadline_days }} days.')",
            tenant_id,
        )
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                context={"outcome": "denied", "member_name": "Jane Roe", "dob": "1980-01-02"},
                actor_id="system", actor_type="system", lob="ma",
            )
        assert len(ids) == 1
        env = await _envelope_for_case(conn, case_id)

    payload = env["payload"]
    # PHI is OFF the event plane — only a reference.
    assert payload.get("member_phi") is True
    assert "body_ref" in payload
    assert "body" not in payload
    assert "subject" not in payload
    assert "Jane Roe" not in json.dumps(payload)

    # The letter WAS rendered WITH PHI and uploaded to MinIO.
    assert len(uploads) == 1
    _, _, uploaded_body = uploads[0]
    assert "Jane Roe" in uploaded_body
    assert "1980-01-02" in uploaded_body


@pytest.mark.asyncio
async def test_non_phi_template_unchanged(pg_pool, monkeypatch):
    """A member_phi=false template still carries body+subject in the event, PHI stripped,
    and triggers no MinIO upload."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    uploads: list[tuple] = []

    def _fake_upload(self, tenant_id, notification_id, body):
        uploads.append((tenant_id, notification_id, body))
        return "should-not-be-called"

    monkeypatch.setattr(comms_service.MinioStore, "upload_notice", _fake_upload)

    service = NotificationService(OutboxPublisher())
    tenant_id = f"phi-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, member_phi, subject_template, body_template) "
            "VALUES ($1, 'denied', 'portal', 'ma', FALSE, 'Denied', "
            "'{{ outcome }} notice. Appeal within {{ appeal_deadline_days }} days.')",
            tenant_id,
        )
        async with conn.transaction():
            ids = await service.render_and_dispatch(
                conn, tenant_id, case_id, "denied",
                context={"outcome": "denied", "member_name": "Jane Roe", "dob": "1980-01-02"},
                actor_id="system", actor_type="system", lob="ma",
            )
        assert len(ids) == 1
        env = await _envelope_for_case(conn, case_id)

    payload = env["payload"]
    assert "body" in payload
    assert "subject" in payload
    assert "body_ref" not in payload
    # member_name was stripped by _PHI_FIELDS — never reaches the non-PHI render.
    assert "Jane Roe" not in payload["body"]
    assert uploads == []


@pytest.mark.asyncio
async def test_phi_upload_failure_is_fail_loud(pg_pool, monkeypatch):
    """If the MinIO upload fails, render_and_dispatch raises — a PHI notice is NEVER
    sent with PHI in the event payload as a fallback."""
    from enstellar_workflow.comms.service import NotificationService
    from enstellar_workflow.outbox.publisher import OutboxPublisher

    def _boom(self, tenant_id, notification_id, body):
        raise RuntimeError("minio down")

    monkeypatch.setattr(comms_service.MinioStore, "upload_notice", _boom)

    service = NotificationService(OutboxPublisher())
    tenant_id = f"phi-test-{uuid.uuid4()}"
    case_id = str(uuid.uuid4())

    async with pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO notification_templates "
            "(tenant_id, event_type, channel, lob, member_phi, subject_template, body_template) "
            "VALUES ($1, 'denied', 'mail', 'ma', TRUE, 'Determination for {{ member_name }}', "
            "'Dear {{ member_name }}: {{ outcome }}.')",
            tenant_id,
        )
        with pytest.raises(RuntimeError):
            async with conn.transaction():
                await service.render_and_dispatch(
                    conn, tenant_id, case_id, "denied",
                    context={"outcome": "denied", "member_name": "Jane Roe", "dob": "1980-01-02"},
                    actor_id="system", actor_type="system", lob="ma",
                )


def test_download_notice_roundtrip(tmp_path, monkeypatch):
    """upload_notice then download_notice returns the original body."""
    import io
    from unittest.mock import MagicMock, patch
    from enstellar_workflow.normalization.storage import MinioStore
    from enstellar_workflow.normalization.config import NormalizationSettings

    settings = NormalizationSettings(
        minio_endpoint="localhost:9000",
        minio_access_key="test",
        minio_secret_key="test",
        minio_bucket="test-bucket",
        minio_secure=False,
    )

    store = MinioStore.__new__(MinioStore)
    store._bucket = "test-bucket"

    stored: dict = {}

    def fake_put(bucket_name, object_name, data, length, content_type):
        stored["key"] = object_name
        stored["body"] = data.read()

    def fake_get(bucket_name, object_name):
        resp = MagicMock()
        resp.read.return_value = stored["body"]
        resp.close = MagicMock()
        resp.release_conn = MagicMock()
        return resp

    mock_client = MagicMock()
    mock_client.put_object.side_effect = fake_put
    mock_client.get_object.side_effect = fake_get
    mock_client.bucket_exists.return_value = True
    store._client = mock_client

    body_ref = store.upload_notice("tenant-t01", "notif-abc", "Dear member, your case was approved.")
    result = store.download_notice(body_ref)
    assert result == "Dear member, your case was approved."

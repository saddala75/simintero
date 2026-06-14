"""MinioStore — stores raw PAS bundles in MinIO object storage.

Key format: {bucket}/{tenant_id}/raw-bundles/{date}/{correlation_id}.json

Store-first-transform-second pattern: call upload() before any mapping attempt.
On mapping errors the raw bundle is already safely stored with provenance.
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

from minio import Minio
from minio.error import S3Error

from .config import NormalizationSettings


class MinioStore:
    """Uploads raw PAS bundle JSON to MinIO and returns the full object key."""

    def __init__(self, settings: NormalizationSettings) -> None:
        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        self._bucket = settings.minio_bucket

    def upload(
        self,
        tenant_id: str,
        correlation_id: str,
        bundle: dict[str, Any],
    ) -> str:
        """Upload raw bundle JSON to MinIO.

        Returns:
            Full object reference: "{bucket}/{object_key}"
            e.g. "enstellar-raw-bundles/tenant-acme/raw-bundles/2026-06-05/corr-abc-123.json"
        """
        self._ensure_bucket()

        today = datetime.now(timezone.utc).date().isoformat()
        object_key = f"{tenant_id}/raw-bundles/{today}/{correlation_id}.json"

        payload = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
        stream = io.BytesIO(payload)
        length = len(payload)

        self._client.put_object(
            bucket_name=self._bucket,
            object_name=object_key,
            data=stream,
            length=length,
            content_type="application/fhir+json",
        )

        return f"{self._bucket}/{object_key}"

    def _ensure_bucket(self) -> None:
        """Create the bucket if it does not exist."""
        try:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)
        except S3Error as exc:
            # Race condition: another process created it between exists() and make()
            if exc.code != "BucketAlreadyOwnedByYou":
                raise

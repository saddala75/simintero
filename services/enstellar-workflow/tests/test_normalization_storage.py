"""Integration tests for MinioStore — requires a running MinIO container.

Uses testcontainers to spin up MinIO for the test session.
"""
from __future__ import annotations

import json
import pathlib

import pytest
from testcontainers.minio import MinioContainer

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
MINIO_IMAGE = "minio/minio:latest"


@pytest.fixture(scope="module")
def minio_container():
    """Spin up a MinIO container for the module-scoped tests."""
    with MinioContainer(image=MINIO_IMAGE) as minio:
        yield minio


@pytest.fixture(scope="module")
def normalization_settings(minio_container):
    """Build NormalizationSettings pointing at the test MinIO container."""
    from enstellar_workflow.normalization.config import NormalizationSettings

    config = minio_container.get_config()

    return NormalizationSettings(
        minio_endpoint=config["endpoint"],
        minio_access_key=config["access_key"],
        minio_secret_key=config["secret_key"],
        minio_secure=False,
        minio_bucket="test-raw-bundles",
    )


@pytest.fixture(scope="module")
def minio_store(normalization_settings):
    from enstellar_workflow.normalization.storage import MinioStore
    return MinioStore(normalization_settings)


@pytest.fixture(scope="module")
def sample_bundle() -> dict:
    return json.loads((FIXTURES / "sample_pas_bundle.json").read_text())


class TestMinioStore:
    def test_upload_returns_nonempty_key(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-001",
            bundle=sample_bundle,
        )
        assert key, "upload() must return a non-empty object key"

    def test_upload_key_contains_tenant_id(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-002",
            bundle=sample_bundle,
        )
        assert "tenant-acme" in key

    def test_upload_key_contains_correlation_id(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-003",
            bundle=sample_bundle,
        )
        assert "corr-store-003" in key

    def test_upload_key_ends_with_json(self, minio_store, sample_bundle):
        key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-store-004",
            bundle=sample_bundle,
        )
        assert key.endswith(".json")

    def test_uploaded_object_is_retrievable(self, minio_store, normalization_settings, sample_bundle):
        """The uploaded bytes must deserialize back to the original bundle."""
        from minio import Minio

        correlation_id = "corr-store-005"
        full_key = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id=correlation_id,
            bundle=sample_bundle,
        )

        # full_key = "bucket/object-path"
        bucket, _, object_key = full_key.partition("/")

        client = Minio(
            normalization_settings.minio_endpoint,
            access_key=normalization_settings.minio_access_key,
            secret_key=normalization_settings.minio_secret_key,
            secure=False,
        )
        response = client.get_object(bucket, object_key)
        try:
            data = json.loads(response.read())
        finally:
            response.close()
            response.release_conn()

        assert data["resourceType"] == "Bundle"
        assert data["id"] == sample_bundle["id"]

    def test_two_uploads_same_correlation_id_idempotent(self, minio_store, sample_bundle):
        """Uploading twice with same correlation_id overwrites (no error thrown)."""
        key1 = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-idem-001",
            bundle=sample_bundle,
        )
        key2 = minio_store.upload(
            tenant_id="tenant-acme",
            correlation_id="corr-idem-001",
            bundle=sample_bundle,
        )
        assert key1 == key2

    def test_different_tenants_produce_different_keys(self, minio_store, sample_bundle):
        key_a = minio_store.upload(
            tenant_id="tenant-a",
            correlation_id="corr-x",
            bundle=sample_bundle,
        )
        key_b = minio_store.upload(
            tenant_id="tenant-b",
            correlation_id="corr-x",
            bundle=sample_bundle,
        )
        assert key_a != key_b
        assert "tenant-a" in key_a
        assert "tenant-b" in key_b

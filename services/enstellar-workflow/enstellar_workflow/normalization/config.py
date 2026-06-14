"""MinIO + normalization settings, loaded from environment variables.

Environment variable names (no prefix):
  MINIO_ENDPOINT     — host:port, e.g. "localhost:9000"
  MINIO_ACCESS_KEY   — MinIO access key (default: minioadmin)
  MINIO_SECRET_KEY   — MinIO secret key (default: minioadmin)
  MINIO_SECURE       — use TLS (default: false)
  MINIO_BUCKET       — target bucket (default: enstellar-raw-bundles)
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class NormalizationSettings(BaseSettings):
    """All fields correspond 1-to-1 with their environment variable names."""
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_secure: bool = False
    minio_bucket: str = "enstellar-raw-bundles"


@lru_cache(maxsize=1)
def get_normalization_settings() -> NormalizationSettings:
    return NormalizationSettings()

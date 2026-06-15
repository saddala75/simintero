"""Workflow engine settings — loaded from environment variables."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WORKFLOW_", case_sensitive=False)

    db_url: str = "postgresql+asyncpg://workflow:workflow_secret@localhost:5432/workflow"

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_consumer_group: str = "workflow-engine"

    outbox_poll_interval_seconds: float = 1.0
    outbox_batch_size: int = 100

    # The relay reads shared.outbox across ALL tenants, so it must bypass RLS.
    # Migration 0011 creates a BYPASSRLS role `sim_relay`; the relay SET ROLEs to
    # it on each connection. Set to empty/None to disable the role switch (e.g.
    # when the relay already connects as a BYPASSRLS principal via its own DSN).
    relay_db_role: str | None = "sim_relay"

    agent_layer_url: str = "http://agent-layer:8000"

    # JWT / OIDC — required in production; absent in local/test environments
    # where JWT auth has not yet been wired to the case endpoints.
    jwks_uri: str | None = None
    oidc_issuer: str | None = None
    expected_audience: str | None = None


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

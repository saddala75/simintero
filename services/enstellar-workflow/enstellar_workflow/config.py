"""Workflow engine settings — loaded from environment variables."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WORKFLOW_", case_sensitive=False)

    # Deployment environment/profile. Used by the startup audience fail-fast
    # guard to distinguish prod (audience MUST be set) from local/test/dev
    # (audience may be unset). Default "local" so dev runs without extra config.
    env: str = "local"

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

    # --- Document Service + Revital (I2b clinical-review pipeline) -----------
    # The ClinicalReviewConsumer resolves a case's documents from the platform
    # Document Service by case_ref (= correlation_id), then submits them to the
    # Revital summarization pipeline and polls for the result.
    document_service_url: str = "http://document-service:3010"
    revital_base_url: str = "http://revital-pipeline:3014"
    revital_poll_interval_seconds: float = 5.0
    revital_poll_timeout_seconds: float = 300.0

    # --- Keycloak JWT / OIDC (realm `simintero`) + OPA -----------------------
    # Adopted from the platform `simintero-authz` package. The JWKS URL and
    # issuer point at the `simintero` Keycloak realm; override per-environment.
    # `oidc_audience` is the expected `aud` claim (set in production so tokens
    # issued for other services are rejected; None disables aud verification).
    keycloak_jwks_url: str = (
        "http://localhost:8080/realms/simintero/protocol/openid-connect/certs"
    )
    oidc_issuer: str = "http://localhost:8080/realms/simintero"
    oidc_audience: str | None = None

    # OPA decision endpoint for the authoritative adverse-action gate. The
    # in-process guard (engine/guards.py) remains as defense-in-depth.
    opa_url: str = "http://localhost:8181"


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

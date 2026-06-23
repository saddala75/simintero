"""Slice 2.1 Task 1 — the workflow engine must expose a SECOND DB DSN
(`simintero_db_url`, env `SIMINTERO_DB_URL`) so a second asyncpg pool can be
opened against the `simintero` database (as `sim_app`) for the fabric bridge.

The existing `db_url` field is prefixed (`WORKFLOW_DB_URL`); the simintero DSN
is intentionally UN-prefixed (`SIMINTERO_DB_URL`) so it matches the plain
`postgresql://sim_app:...@postgres/simintero` form the other simintero services
already use. It is optional (default None) so the service still boots when unset.
"""
from enstellar_workflow.config import Settings


def test_settings_expose_simintero_db_url(monkeypatch):
    monkeypatch.setenv(
        "SIMINTERO_DB_URL",
        "postgresql://sim_app:devpassword@localhost:5432/simintero",
    )
    s = Settings()
    assert s.simintero_db_url == "postgresql://sim_app:devpassword@localhost:5432/simintero"


def test_settings_simintero_db_url_optional_defaults_none(monkeypatch):
    monkeypatch.delenv("SIMINTERO_DB_URL", raising=False)
    s = Settings()
    assert s.simintero_db_url is None

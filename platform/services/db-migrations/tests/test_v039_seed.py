"""Verify V039 seeded both claude-pa artifacts in vkas.artifact."""
import os
import pytest
import asyncpg


DB_DSN = os.environ.get("SIMINTERO_DB_URL") or os.environ.get("TEST_DB_URL")


@pytest.mark.asyncio
@pytest.mark.skipif(not DB_DSN, reason="no DB_DSN in env — skipped in unit CI")
async def test_claude_pa_model_binding_exists():
    conn = await asyncpg.connect(DB_DSN)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'shared'")
        row = await conn.fetchrow(
            "SELECT artifact_type, status, content->>'provider' AS provider "
            "FROM vkas.artifact WHERE canonical_url = $1 AND version = $2",
            "https://artifacts.simintero.io/shared/model_binding/claude-pa",
            "1.0.0",
        )
        assert row is not None, "claude-pa model_binding row missing"
        assert row["artifact_type"] == "model_binding"
        assert row["status"] == "active"
        assert row["provider"] == "anthropic"
    finally:
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DB_DSN, reason="no DB_DSN in env — skipped in unit CI")
async def test_pa_review_prompt_exists():
    conn = await asyncpg.connect(DB_DSN)
    try:
        await conn.execute("SET LOCAL sim.tenant_id = 'shared'")
        row = await conn.fetchrow(
            "SELECT artifact_type, status FROM vkas.artifact "
            "WHERE canonical_url = $1 AND version = $2",
            "https://artifacts.simintero.io/shared/prompt/pa-review",
            "1.0.0",
        )
        assert row is not None, "pa-review prompt row missing"
        assert row["artifact_type"] == "prompt"
        assert row["status"] == "active"
    finally:
        await conn.close()

import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import manifest from "../manifest.json";

const tenantA = "t_synth_a";
const tenantB = "t_synth_b";

async function runSetup(pool: Pool): Promise<void> {
  const setupSql = fs.readFileSync(
    path.join(__dirname, "test-setup.sql"),
    "utf8"
  );
  // The harness login role (sim/postgres) is the cluster superuser, so it
  // bypasses RLS and the sentinel inserts (including cross-tenant ones) apply.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(setupSql);
    await client.query("COMMIT");
    console.log("Test setup complete: sentinel rows inserted for t_synth_a and t_synth_b");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function runHarness(pool: Pool): Promise<void> {
  const errors: string[] = [];

  for (const { schema, table, tenant_column } of manifest.tables) {
    const qualified = `"${schema}"."${table}"`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Assert as the non-superuser app role so FORCE RLS actually applies.
      await client.query("SET ROLE sim_app");
      await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantA]);

      // NEGATIVE: tenantA must NOT see any of tenantB's rows.
      const leak = await client.query(
        `SELECT count(*)::int AS cnt FROM ${qualified} WHERE "${tenant_column}" = $1`,
        [tenantB]
      );
      if ((leak.rows[0]?.cnt ?? 0) > 0) {
        errors.push(
          `FAIL leak: ${qualified} — '${tenantA}' sees ${leak.rows[0].cnt} of '${tenantB}'`
        );
      }

      // POSITIVE: tenantA MUST see its own row (so denial-of-everything can't pass).
      const own = await client.query(
        `SELECT count(*)::int AS cnt FROM ${qualified} WHERE "${tenant_column}" = $1`,
        [tenantA]
      );
      if ((own.rows[0]?.cnt ?? 0) < 1) {
        errors.push(
          `FAIL own: ${qualified} — '${tenantA}' cannot see its own row`
        );
      } else {
        console.log(`PASS: ${qualified}`);
      }
    } catch (e) {
      errors.push(`ERROR ${qualified}: ${(e as Error).message}`);
    } finally {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      client.release();
    }
  }

  // vkas.artifact shared rows must be visible under any tenant.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET ROLE sim_app");
    await c.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tenantA]);
    const shared = await c.query(
      `SELECT count(*)::int AS cnt FROM vkas.artifact WHERE tenant_id = 'shared'`
    );
    if ((shared.rows[0]?.cnt ?? 0) < 1) {
      errors.push(`FAIL shared: vkas.artifact shared rows not visible to '${tenantA}'`);
    } else {
      console.log("PASS: vkas.artifact shared-visibility");
    }
  } finally {
    try { await c.query("ROLLBACK"); } catch { /* ignore */ }
    c.release();
  }

  if (errors.length) {
    errors.forEach((e) => console.error(e));
    process.exitCode = 1;
    return;
  }
  console.log(`RLS harness: all ${manifest.tables.length} tables isolated.`);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
  try {
    await runSetup(pool);
    await runHarness(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

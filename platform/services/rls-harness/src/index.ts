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
  // Run setup as superuser role — bypasses RLS to insert sentinel rows
  const client = await pool.connect();
  try {
    await client.query("SET LOCAL role = postgres");
    await client.query(setupSql);
    console.log("Test setup complete: sentinel rows inserted for t_synth_a and t_synth_b");
  } finally {
    client.release();
  }
}

async function runHarness(pool: Pool): Promise<void> {
  const errors: string[] = [];

  for (const { schema, table, tenant_column } of manifest.tables) {
    const qualifiedTable = `"${schema}"."${table}"`;

    // Verify tenantA CANNOT see tenantB's rows
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('sim.tenant_id', $1, true)`,
        [tenantA]
      );

      const { rows } = await client.query(
        `SELECT count(*)::int AS cnt FROM ${qualifiedTable} WHERE ${tenant_column} = $1`,
        [tenantB]
      );

      if ((rows[0]?.cnt ?? 0) > 0) {
        errors.push(
          `FAIL: Cross-tenant leak on ${qualifiedTable}: tenant '${tenantA}' can see ${rows[0]?.cnt} rows belonging to '${tenantB}'`
        );
      } else {
        console.log(`PASS: ${qualifiedTable} — RLS blocks cross-tenant read`);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // Verify tenantA CAN see its own rows
    const ownClient = await pool.connect();
    try {
      await ownClient.query("BEGIN");
      await ownClient.query(
        `SELECT set_config('sim.tenant_id', $1, true)`,
        [tenantA]
      );

      const { rows } = await ownClient.query(
        `SELECT count(*)::int AS cnt FROM ${qualifiedTable} WHERE ${tenant_column} = $1`,
        [tenantA]
      );

      if ((rows[0]?.cnt ?? 0) === 0) {
        errors.push(
          `WARN: ${qualifiedTable} — tenant '${tenantA}' cannot see its own rows (RLS may be over-restrictive or setup failed)`
        );
      }
    } finally {
      await ownClient.query("ROLLBACK");
      ownClient.release();
    }
  }

  if (errors.length > 0) {
    console.error("\nRLS HARNESS FAILURES:");
    errors.forEach((e) => console.error(e));
    process.exit(1);
  }

  console.log("\nAll RLS checks passed.");
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

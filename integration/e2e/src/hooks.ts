import { After, setDefaultTimeout } from '@cucumber/cucumber';
import { SimWorld } from './world';

setDefaultTimeout(30_000);

/**
 * After every scenario tagged @wipe_tenants:
 * Delete all rows created during the scenario for the two synthetic tenants.
 * Order matters: delete child tables before parent tables to avoid FK violations.
 */
After({ tags: '@wipe_tenants' }, async function (this: SimWorld) {
  const tenants = ['t_synth_ma', 't_synth_medicaid'];

  // shared.processed_events has no RLS — simple delete
  await this.pool.query(`DELETE FROM shared.processed_events`);

  for (const tid of tenants) {
    // RLS-protected tables require sim.tenant_id to be set
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('sim.tenant_id', $1, true)`, [tid]);
      await client.query(`DELETE FROM shared.outbox WHERE tenant_id = $1`, [tid]);
      await client.query(`DELETE FROM ens.case_event WHERE tenant_id = $1`, [tid]);
      await client.query(`DELETE FROM ens.case WHERE tenant_id = $1`, [tid]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
    // ctrl tables have no RLS
    await this.pool.query(`DELETE FROM ctrl.entitlement WHERE tenant_id = $1`, [tid]);
    await this.pool.query(`DELETE FROM ctrl.tenant WHERE tenant_id = $1`, [tid]);
  }

  await this.cleanup();
});

/**
 * After every other scenario (not @wipe_tenants) — just close the pool.
 */
After({ tags: 'not @wipe_tenants' }, async function (this: SimWorld) {
  await this.cleanup();
});

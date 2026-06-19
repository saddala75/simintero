import { describe, it, expect, vi } from 'vitest';
import { appendEvent } from './append.js';

function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  return { calls, query: vi.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [] }; }) };
}

describe('appendEvent', () => {
  it('inserts the canonical 5-column row with explicit topic', async () => {
    const c = fakeClient();
    const id = await appendEvent(c as never, {
      schemaRef: 'sim.claims.lifecycle/CaseOpened/v1', topic: 'sim.claims.lifecycle',
      tenantId: 't1', payload: { case_ref: 'c1' }, correlationId: 'c1',
    });
    expect(id).toMatch(/^evt_/);
    const ins = c.calls.find((q) => q.sql.includes('INSERT INTO shared.outbox'))!;
    expect(ins.sql).toContain('(event_id, topic, key, envelope, tenant_id)');
    expect(ins.params[1]).toBe('sim.claims.lifecycle');
    expect(ins.params[2]).toBe('c1');
    expect(ins.params[4]).toBe('t1');
    const env = JSON.parse(ins.params[3] as string);
    expect(env.schema_ref).toBe('sim.claims.lifecycle/CaseOpened/v1');
    expect(env.tenant.tenant_id).toBe('t1');
    expect(env.payload).toEqual({ case_ref: 'c1' });
    expect(env.event_id).toBe(ins.params[0]);
  });

  it('defaults key to tenantId and derives topic via topicFor for canonical schema_refs', async () => {
    const c = fakeClient();
    await appendEvent(c as never, { schemaRef: 'sim.tenant.created', tenantId: 't2', payload: {} });
    const ins = c.calls.find((q) => q.sql.includes('INSERT INTO shared.outbox'))!;
    expect(ins.params[1]).toBe('sim.tenant.admin');
    expect(ins.params[2]).toBe('t2');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted to the top of the file by Vitest.  The factory must not
// reference any variables declared outside of it — use vi.fn() inline and
// capture references via vi.mocked() after the import.
vi.mock('@sim/outbox-ts', () => ({
  createOutbox: vi.fn(() => ({ append: vi.fn().mockResolvedValue(undefined) })),
  topicFor: vi.fn((_ref: string) => 'sim.artifact'),
}));

import { OutboxNotificationClient } from '../notifications/OutboxNotificationClient.js';
import * as outboxModule from '@sim/outbox-ts';

// Minimal pg.Pool stub — only connect() is needed by poolToTenantDb
function makeMockPool() {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
  const mockRelease = vi.fn();
  const mockClient = { query: mockQuery, release: mockRelease };
  return {
    pool: { connect: vi.fn().mockResolvedValue(mockClient) } as unknown as import('pg').Pool,
    mockClient,
    mockQuery,
  };
}

describe('OutboxNotificationClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-stub createOutbox so each test gets a fresh append mock
    vi.mocked(outboxModule.createOutbox).mockReturnValue({
      append: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('passes a TenantDb adapter (not the raw pool) to createOutbox on construction', () => {
    const { pool } = makeMockPool();
    new OutboxNotificationClient(pool);

    expect(vi.mocked(outboxModule.createOutbox)).toHaveBeenCalledOnce();
    const arg = vi.mocked(outboxModule.createOutbox).mock.calls[0]?.[0];
    expect(arg).toHaveProperty('transaction');
    expect(typeof arg?.transaction).toBe('function');
  });

  it('calls outbox.append with a well-formed EventEnvelope for an approval event', async () => {
    const { pool } = makeMockPool();
    const client = new OutboxNotificationClient(pool);

    await client.emit({
      event_type: 'sim.artifact.approval_recorded',
      artifact_id: 'art-abc',
      gate: 'clinical',
      decision: 'approved',
    });

    const outbox = vi.mocked(outboxModule.createOutbox).mock.results[0]?.value as { append: ReturnType<typeof vi.fn> };
    expect(outbox.append).toHaveBeenCalledOnce();
    const envelope = outbox.append.mock.calls[0]?.[0];

    expect(envelope).toMatchObject({
      schema_ref: 'sim.artifact.approval_recorded/v1',
      correlation_id: 'artifact_art-abc',
      causation_id: null,
      actor: { type: 'service', id: 'digicore-governance' },
      trace_ref: null,
      payload: {
        artifact_id: 'art-abc',
        gate: 'clinical',
        decision: 'approved',
      },
    });
    expect(typeof envelope.event_id).toBe('string');
    expect(envelope.event_id.length).toBeGreaterThan(0);
    expect(typeof envelope.occurred_at).toBe('string');
    expect(envelope.tenant).toHaveProperty('tenant_id');
  });

  it('omits gate and decision from payload when not provided (activation event)', async () => {
    const { pool } = makeMockPool();
    const client = new OutboxNotificationClient(pool);

    await client.emit({
      event_type: 'sim.artifact.activated',
      artifact_id: 'art-xyz',
    });

    const outbox = vi.mocked(outboxModule.createOutbox).mock.results[0]?.value as { append: ReturnType<typeof vi.fn> };
    expect(outbox.append).toHaveBeenCalledOnce();
    const envelope = outbox.append.mock.calls[0]?.[0];

    expect(envelope).toMatchObject({
      schema_ref: 'sim.artifact.activated/v1',
      correlation_id: 'artifact_art-xyz',
      payload: { artifact_id: 'art-xyz' },
    });
    expect(envelope.payload).not.toHaveProperty('gate');
    expect(envelope.payload).not.toHaveProperty('decision');
  });

  it('generates a unique event_id for each emit call', async () => {
    const { pool } = makeMockPool();
    const appendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(outboxModule.createOutbox).mockReturnValue({ append: appendMock });

    const client = new OutboxNotificationClient(pool);
    await client.emit({ event_type: 'sim.artifact.activated', artifact_id: 'a1' });
    await client.emit({ event_type: 'sim.artifact.activated', artifact_id: 'a2' });

    const id1 = appendMock.mock.calls[0]?.[0]?.event_id;
    const id2 = appendMock.mock.calls[1]?.[0]?.event_id;
    expect(id1).not.toBe(id2);
  });

  it('uses GOVERNANCE_TENANT_ID env-var when set', async () => {
    const original = process.env['GOVERNANCE_TENANT_ID'];
    process.env['GOVERNANCE_TENANT_ID'] = 'tenant-test-42';

    const appendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(outboxModule.createOutbox).mockReturnValue({ append: appendMock });

    try {
      const { pool } = makeMockPool();
      const client = new OutboxNotificationClient(pool);
      await client.emit({ event_type: 'sim.artifact.activated', artifact_id: 'a1' });

      const envelope = appendMock.mock.calls[0]?.[0];
      expect(envelope.tenant.tenant_id).toBe('tenant-test-42');
    } finally {
      if (original === undefined) delete process.env['GOVERNANCE_TENANT_ID'];
      else process.env['GOVERNANCE_TENANT_ID'] = original;
    }
  });

  it('falls back to "system" tenant when GOVERNANCE_TENANT_ID is not set', async () => {
    const original = process.env['GOVERNANCE_TENANT_ID'];
    delete process.env['GOVERNANCE_TENANT_ID'];

    const appendMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(outboxModule.createOutbox).mockReturnValue({ append: appendMock });

    try {
      const { pool } = makeMockPool();
      const client = new OutboxNotificationClient(pool);
      await client.emit({ event_type: 'sim.artifact.activated', artifact_id: 'a1' });

      const envelope = appendMock.mock.calls[0]?.[0];
      expect(envelope.tenant.tenant_id).toBe('system');
    } finally {
      if (original !== undefined) process.env['GOVERNANCE_TENANT_ID'] = original;
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { persistMeasureReport } from '../activities/persistMeasureReport.js';

const RESULT = {
  member_id: 'member-001',
  measure_ref: 'hedis:BCS-E',
  numerator: true,
  denominator: true,
  exclusion: false,
  evidence_refs: ['obs-001'],
  trace_ref: 'qual-trace:x',
};

describe('persistMeasureReport', () => {
  it('inserts measure_report + a correct shared.outbox event', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    await persistMeasureReport(
      { query } as any,
      'run-1',
      'tenant-dev',
      RESULT as any,
      '2026-01-01',
      '2026-06-30',
    );
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => /INSERT INTO qual\.measure_report/i.test(s))).toBe(true);
    const outbox = query.mock.calls.find((c) =>
      /INSERT INTO shared\.outbox/i.test(c[0] as string),
    );
    expect(outbox).toBeTruthy();
    // real columns, NOT the old (tenant_id, topic, payload)
    expect(outbox![0] as string).toMatch(/\(event_id, topic, key, envelope, tenant_id\)/);
    expect(outbox![0] as string).not.toMatch(/payload\)/);
    const params = outbox![1] as any[];
    const envelope = JSON.parse(
      params.find((p) => typeof p === 'string' && p.includes('schema_ref')),
    );
    expect(envelope.schema_ref).toBe('sim.qual.measure/MeasureReportCompleted/v1');
    expect(envelope.payload.event_type).toBe('MeasureReportCompleted');
    expect(envelope.payload.numerator).toBe(true);
  });
});

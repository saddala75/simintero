import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoricalReplayer } from '../runner/HistoricalReplayer.js';
import type { TestCase } from '../schema/SimulationRun.js';

const CASE_A: TestCase = {
  test_case_id: 'case-a',
  evidence: { diagnosis_documented: true, conservative_therapy_tried: true, imaging_documented: true },
  expected_outcome: 'meets_all',
};

const CASE_B: TestCase = {
  test_case_id: 'case-b',
  evidence: { diagnosis_documented: true, conservative_therapy_tried: true, imaging_documented: false },
  expected_outcome: 'not_met',
};

describe('HistoricalReplayer', () => {
  it('replay() loads all JSON files from directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-replayer-'));
    try {
      writeFileSync(join(dir, 'case-a.json'), JSON.stringify(CASE_A));
      writeFileSync(join(dir, 'case-b.json'), JSON.stringify(CASE_B));

      const replayer = new HistoricalReplayer(dir);
      const cases = await replayer.replay();

      expect(cases).toHaveLength(2);
      const ids = cases.map((c) => c.test_case_id).sort();
      expect(ids).toEqual(['case-a', 'case-b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replay() returns empty array for empty directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-replayer-empty-'));
    try {
      const replayer = new HistoricalReplayer(dir);
      const cases = await replayer.replay();
      expect(cases).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('replay() ignores non-JSON files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-replayer-mixed-'));
    try {
      writeFileSync(join(dir, 'case-a.json'), JSON.stringify(CASE_A));
      writeFileSync(join(dir, 'README.txt'), 'not a test case');
      writeFileSync(join(dir, '.gitkeep'), '');

      const replayer = new HistoricalReplayer(dir);
      const cases = await replayer.replay();

      expect(cases).toHaveLength(1);
      expect(cases[0]?.test_case_id).toBe('case-a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

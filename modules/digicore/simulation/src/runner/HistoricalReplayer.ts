import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TestCase } from '../schema/SimulationRun.js';

export class HistoricalReplayer {
  constructor(private readonly testCasesDir: string) {}

  async replay(): Promise<TestCase[]> {
    const files = readdirSync(this.testCasesDir).filter((f) => f.endsWith('.json'));
    return files.map(
      (f) => JSON.parse(readFileSync(join(this.testCasesDir, f), 'utf-8')) as TestCase,
    );
  }
}

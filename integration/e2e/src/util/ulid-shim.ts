import { createHash, randomBytes } from 'node:crypto';

// Deterministic ULID-like string for test fixtures: timestamp prefix + hash suffix
export function testUlid(seed: string): string {
  const tsPrefix = '01J9SYNTHTEST';
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 13).toUpperCase();
  return `${tsPrefix}${hash}`;
}

// Random 16-byte hex, useful for unique event IDs in tests
export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

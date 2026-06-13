import { PHI_ALLOW_LIST } from './allow-list.js';

const PHI_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\bMRN[-:\s]*\d+\b/gi,
  /\bDOB[-:\s]?\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi,
];

export function applyPhiFilter(
  taskKind: string,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = PHI_ALLOW_LIST[taskKind];
  if (!allowed) throw new Error(`Unknown task_kind: ${taskKind}`);

  const filtered: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in inputs) {
      filtered[key] = redact(inputs[key]);
    }
  }
  return filtered;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return PHI_PATTERNS.reduce((v, p) => v.replace(p, '[REDACTED]'), value);
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v)]),
    );
  }
  return value;
}

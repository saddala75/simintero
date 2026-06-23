export interface PathDiff {
  path: string;
  op: 'add' | 'remove' | 'replace';
  before?: unknown;
  after?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (isArray(a) && isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function diffAt(prefix: string, before: unknown, after: unknown, out: PathDiff[]): void {
  if (isPlainObject(before) && isPlainObject(after)) {
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      const path = `${prefix}/${key}`;
      if (hasBefore && hasAfter) {
        diffAt(path, before[key], after[key], out);
      } else if (hasBefore) {
        out.push({ path, op: 'remove', before: before[key] });
      } else {
        out.push({ path, op: 'add', after: after[key] });
      }
    }
    return;
  }

  if (isArray(before) && isArray(after)) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      const path = `${prefix}/${i}`;
      const hasBefore = i < before.length;
      const hasAfter = i < after.length;
      if (hasBefore && hasAfter) {
        diffAt(path, before[i], after[i], out);
      } else if (hasBefore) {
        out.push({ path, op: 'remove', before: before[i] });
      } else {
        out.push({ path, op: 'add', after: after[i] });
      }
    }
    return;
  }

  // Scalar or type-mismatch
  if (!deepEqual(before, after)) {
    out.push({ path: prefix, op: 'replace', before, after });
  }
}

export function jsonDiff(before: unknown, after: unknown): PathDiff[] {
  const out: PathDiff[] = [];
  diffAt('', before, after, out);
  return out;
}

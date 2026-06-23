import { describe, it, expect } from 'vitest';
import { jsonDiff, type PathDiff } from './diff.js';

describe('jsonDiff', () => {
  it('returns empty array for identical objects', () => {
    const result = jsonDiff({ a: 1, b: 'hello' }, { a: 1, b: 'hello' });
    expect(result).toEqual([]);
  });

  it('detects a changed scalar at a nested path', () => {
    const result = jsonDiff({ a: { b: 1 } }, { a: { b: 2 } });
    expect(result).toEqual([
      { path: '/a/b', op: 'replace', before: 1, after: 2 },
    ]);
  });

  it('detects an added key', () => {
    const result = jsonDiff({ a: 1 }, { a: 1, c: 'new' });
    expect(result).toEqual([
      { path: '/c', op: 'add', after: 'new' },
    ]);
    // must NOT have a 'before' key at all (exactOptionalPropertyTypes)
    expect(Object.prototype.hasOwnProperty.call(result[0], 'before')).toBe(false);
  });

  it('detects a removed key', () => {
    const result = jsonDiff({ a: 1, c: 'old' }, { a: 1 });
    expect(result).toEqual([
      { path: '/c', op: 'remove', before: 'old' },
    ]);
    // must NOT have an 'after' key at all (exactOptionalPropertyTypes)
    expect(Object.prototype.hasOwnProperty.call(result[0], 'after')).toBe(false);
  });

  it('detects an array element change', () => {
    const result = jsonDiff({ arr: ['x', 'y'] }, { arr: ['x', 'z'] });
    expect(result).toEqual([
      { path: '/arr/1', op: 'replace', before: 'y', after: 'z' },
    ]);
  });

  it('detects added array element (longer after)', () => {
    const result = jsonDiff({ arr: [1] }, { arr: [1, 2] });
    expect(result).toEqual([
      { path: '/arr/1', op: 'add', after: 2 },
    ]);
  });

  it('detects removed array element (longer before)', () => {
    const result = jsonDiff({ arr: [1, 2] }, { arr: [1] });
    expect(result).toEqual([
      { path: '/arr/1', op: 'remove', before: 2 },
    ]);
  });

  it('detects multiple changes and returns all paths', () => {
    const before = { a: 1, b: 'hello', c: { d: true } };
    const after  = { a: 2, b: 'hello', c: { d: false } };
    const result = jsonDiff(before, after);
    const paths = result.map((d: PathDiff) => d.path);
    expect(paths).toContain('/a');
    expect(paths).toContain('/c/d');
    expect(paths).not.toContain('/b');
  });

  it('emits replace when type changes (object vs scalar)', () => {
    const result = jsonDiff({ a: { nested: true } }, { a: 42 });
    expect(result).toEqual([
      { path: '/a', op: 'replace', before: { nested: true }, after: 42 },
    ]);
  });

  it('returns empty array for two empty objects', () => {
    expect(jsonDiff({}, {})).toEqual([]);
  });

  it('handles deeply nested changes', () => {
    const result = jsonDiff(
      { x: { y: { z: 'old' } } },
      { x: { y: { z: 'new' } } },
    );
    expect(result).toEqual([
      { path: '/x/y/z', op: 'replace', before: 'old', after: 'new' },
    ]);
  });
});

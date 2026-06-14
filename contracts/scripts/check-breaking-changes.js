#!/usr/bin/env node
// Fails (exit 1) when a contract JSON Schema changes incompatibly vs the git
// baseline (default origin/main) without a major version bump. Rules:
//   - a property removed from `properties`
//   - a value added to `required`
//   - an enum value removed
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BASELINE = process.env.CONTRACT_BASELINE_REF || 'origin/main';

// Scope: this only inspects inline object `properties`/`required`/`enum`. It does
// NOT recurse into array `items` and does NOT follow `$ref`s.
export function breakingChanges(oldS, newS, path, trail = '') {
  const issues = [];
  if (!oldS || !newS) return issues;
  const oldProps = oldS.properties || {};
  const newProps = newS.properties || {};
  for (const k of Object.keys(oldProps)) {
    if (!(k in newProps)) issues.push(`${path}${trail}: removed property: ${k}`);
  }
  const oldReq = new Set(oldS.required || []);
  for (const r of newS.required || []) {
    if (!oldReq.has(r)) issues.push(`${path}${trail}: newly required: ${r}`);
  }
  for (const k of Object.keys(oldProps)) {
    const o = oldProps[k], n = newProps[k];
    if (!n) continue;
    if (Array.isArray(o.enum) && Array.isArray(n.enum)) {
      const nset = new Set(n.enum);
      for (const v of o.enum) if (!nset.has(v)) issues.push(`${path}${trail}.${k}: enum value removed: ${v}`);
    }
    if (o.type === 'object' || o.properties) {
      issues.push(...breakingChanges(o, n, path, `${trail}.${k}`));
    }
  }
  return issues;
}

function listJson(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listJson(p));
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}

// Only run the walk when invoked as a CLI (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  const SCHEMA_DIR = join(REPO_ROOT, 'contracts', 'schemas');

  // Fail closed: refuse to run if the baseline ref does not resolve. Otherwise a
  // missing ref (e.g. shallow CI clone) would make every `git show` fail, every
  // baseline null, every schema skipped, and the gate pass while checking nothing.
  try { execSync(`git rev-parse --verify --quiet ${BASELINE}^{commit}`, { stdio: 'ignore' }); }
  catch { console.error(`Baseline ref '${BASELINE}' not found (is it fetched? in shallow CI use fetch-depth:0). Refusing to run breaking-change check fail-open.`); process.exit(1); }

  function baseline(absPath) {
    const rel = relative(REPO_ROOT, absPath).split(sep).join('/');
    try {
      return JSON.parse(execSync(`git show ${BASELINE}:${rel}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    } catch (e) {
      const msg = String((e && e.stderr) || (e && e.message) || '');
      // Path genuinely absent in the baseline ref => new file => additive, skip.
      if (/does not exist in|exists on disk, but not in|path '.*' does not exist/.test(msg)) return null;
      // Any other failure (bad ref, corrupt object, etc.) must NOT pass silently.
      throw new Error(`git show failed for '${rel}' @ ${BASELINE}: ${msg}`);
    }
  }

  // major() is always 1 today because schemas carry no `$schemaVersion` field, so
  // the major-bump escape hatch is currently inert and ALL breaking changes are
  // blocked. Intended for now.
  const major = (s) => parseInt(String(s.$schemaVersion || '1.0.0').split('.')[0], 10);

  try {
    const all = [];
    for (const absPath of listJson(SCHEMA_DIR)) {
      const oldS = baseline(absPath);
      const newS = JSON.parse(readFileSync(absPath, 'utf8'));
      if (!oldS) continue;
      const issues = breakingChanges(oldS, newS, relative(REPO_ROOT, absPath).split(sep).join('/'));
      if (issues.length && major(newS) <= major(oldS)) all.push(...issues);
    }
    if (all.length) {
      console.error('Breaking contract changes without a major bump:\n' + all.map(i => '  ✗ ' + i).join('\n'));
      process.exit(1);
    }
    console.log('Contract breaking-change check: OK');
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
}

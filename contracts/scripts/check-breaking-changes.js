#!/usr/bin/env node
// Fails (exit 1) when a contract JSON Schema changes incompatibly vs the git
// baseline (default origin/main) without a major version bump. Rules:
//   - a property removed from `properties`
//   - a value added to `required`
//   - an enum value removed
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = process.env.CONTRACT_BASELINE_REF || 'origin/main';
const ROOT = 'contracts/schemas';

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

function baseline(path) {
  try { return JSON.parse(execSync(`git show ${BASELINE}:${path}`, { encoding: 'utf8' })); }
  catch { return null; } // new file → additive
}

// Only run the walk when invoked as a CLI (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  const major = (s) => parseInt(String(s.$schemaVersion || '1.0.0').split('.')[0], 10);
  const all = [];
  for (const path of listJson(ROOT)) {
    const oldS = baseline(path);
    const newS = JSON.parse(readFileSync(path, 'utf8'));
    if (!oldS) continue;
    const issues = breakingChanges(oldS, newS, path);
    if (issues.length && major(newS) <= major(oldS)) all.push(...issues);
  }
  if (all.length) {
    console.error('Breaking contract changes without a major bump:\n' + all.map(i => '  ✗ ' + i).join('\n'));
    process.exit(1);
  }
  console.log('Contract breaking-change check: OK');
}

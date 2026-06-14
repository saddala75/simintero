import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = new URL('../schemas/', import.meta.url).pathname;

function loadAll(dir) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(full, f), 'utf8')));
}

test('every canonical schema compiles and $refs resolve', () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schemas = [...loadAll('canonical'), ...loadAll('envelope'), ...loadAll('events')];
  assert.ok(schemas.length > 0, 'expected at least one schema');
  for (const s of schemas) ajv.addSchema(s, s.$id);
  // compiling each forces $ref resolution; throws if a $ref is dangling
  for (const s of schemas) ajv.getSchema(s.$id) ?? ajv.compile(s);
});

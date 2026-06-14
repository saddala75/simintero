import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const url = (p) => new URL(p, import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(url(p), 'utf8'));
const loadDir = (rel) => {
  const dir = url(rel);
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => load(join(rel, f)));
};

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
// Register every canonical + envelope schema so absolute $id $refs resolve.
for (const s of [...loadDir('../schemas/canonical'), ...loadDir('../schemas/envelope')]) {
  ajv.addSchema(s, s.$id);
}
const validate = ajv.compile(load('../schemas/events/case-state-changed.json'));

test('case-state-changed payload validates', () => {
  assert.equal(validate(load('./fixtures/payload.case-state-changed.json')), true, JSON.stringify(validate.errors));
});

test('case-state-changed rejects unknown status', () => {
  assert.equal(validate({ from_status: 'intake', to_status: 'banana', case_id: 'case_1' }), false);
});

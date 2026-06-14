import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const url = (p) => new URL(p, import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(url(p), 'utf8'));

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(load('../schemas/envelope/event-envelope.schema.json'));

test('accepts a well-formed platform envelope', () => {
  assert.equal(validate(load('./fixtures/envelope.valid.json')), true, JSON.stringify(validate.errors));
});

test('rejects the old Enstellar-shaped envelope (flat tenant_id, uuid id)', () => {
  assert.equal(validate(load('./fixtures/envelope.enstellar-shape.json')), false);
});

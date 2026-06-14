import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yaml = readFileSync(new URL('../asyncapi/c3-event-catalog.yaml', import.meta.url), 'utf8');

test('case-lifecycle messages reference typed payload schemas', () => {
  for (const ref of [
    'events/case-state-changed.json',
    'events/case-intake-received.json',
    'events/decision-recorded.json',
  ]) {
    assert.ok(yaml.includes(ref), `expected catalog to reference ${ref}`);
  }
});

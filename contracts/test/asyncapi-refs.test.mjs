import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const catalogPath = fileURLToPath(new URL('../asyncapi/c3-event-catalog.yaml', import.meta.url));
const catalogDir = dirname(catalogPath);
const yaml = readFileSync(catalogPath, 'utf8');

// Collect every external file $ref (relative paths beginning with ../ or ./).
const refs = [...yaml.matchAll(/\$ref:\s*['"]?(\.\.?\/[^'"\s]+)['"]?/g)].map(m => m[1]);

test('every external $ref in the C-3 catalog resolves to a file on disk', () => {
  assert.ok(refs.length > 0, 'expected at least one external $ref');
  const missing = refs.filter(r => !existsSync(resolve(catalogDir, r)));
  assert.deepEqual(missing, [], `dangling $refs: ${missing.join(', ')}`);
});

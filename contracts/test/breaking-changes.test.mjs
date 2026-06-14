import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakingChanges } from '../scripts/check-breaking-changes.js';

test('removing a required property is breaking', () => {
  const oldS = { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } };
  const newS = { type: 'object', required: ['a'], properties: { a: {} } };
  const issues = breakingChanges(oldS, newS, 'x.json');
  assert.ok(issues.some(i => i.includes('removed property: b')));
});

test('adding a required property is breaking', () => {
  const oldS = { type: 'object', required: ['a'], properties: { a: {} } };
  const newS = { type: 'object', required: ['a', 'c'], properties: { a: {}, c: {} } };
  const issues = breakingChanges(oldS, newS, 'x.json');
  assert.ok(issues.some(i => i.includes('newly required: c')));
});

test('narrowing an enum is breaking', () => {
  const oldS = { properties: { s: { enum: ['x', 'y'] } } };
  const newS = { properties: { s: { enum: ['x'] } } };
  const issues = breakingChanges(oldS, newS, 'x.json');
  assert.ok(issues.some(i => i.includes('enum value removed')));
});

test('additive change is not breaking', () => {
  const oldS = { type: 'object', required: ['a'], properties: { a: {} } };
  const newS = { type: 'object', required: ['a'], properties: { a: {}, b: {} } };
  assert.deepEqual(breakingChanges(oldS, newS, 'x.json'), []);
});

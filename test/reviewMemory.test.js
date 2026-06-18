import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getFinding,
  isDuplicate,
  recordFinding,
} from '../src/services/reviewMemory.js';

test('unseen fingerprint is not a duplicate', () => {
  const state = {};
  assert.equal(isDuplicate(state, { fingerprint: 'fp1', codeHash: 'c1' }), false);
});

test('same fingerprint + unchanged codeHash is a Duplicate Finding (skip)', () => {
  const state = {};
  recordFinding(state, { fingerprint: 'fp1', codeHash: 'c1', file: 'a.js' }, 1000);
  assert.equal(isDuplicate(state, { fingerprint: 'fp1', codeHash: 'c1' }), true);
});

test('same fingerprint + changed codeHash is reviewable again (not duplicate)', () => {
  const state = {};
  recordFinding(state, { fingerprint: 'fp1', codeHash: 'c1' }, 1000);
  assert.equal(isDuplicate(state, { fingerprint: 'fp1', codeHash: 'c2' }), false);
});

test('recordFinding stores the record and tracks seen_count', () => {
  const state = {};
  recordFinding(state, { fingerprint: 'fp1', codeHash: 'c1' }, 1000);
  recordFinding(state, { fingerprint: 'fp1', codeHash: 'c2' }, 2000);
  const rec = getFinding(state, 'fp1');
  assert.equal(rec.seen_count, 2);
  assert.equal(rec.first_seen, 1000);
  assert.equal(rec.last_seen, 2000);
  assert.equal(rec.codeHash, 'c2');
});

test('getFinding returns null for unknown fingerprint', () => {
  assert.equal(getFinding({}, 'nope'), null);
});

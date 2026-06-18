import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFinding } from '../src/services/reviewGate.js';

function complete(overrides = {}) {
  return {
    file: 'src/a.js',
    line: 10,
    severity: 'major',
    confidence: 'high',
    failureMode: 'null deref when list is empty',
    evidence: '+ const x = list[0].id;',
    fixDirection: 'guard for empty list before indexing',
    body: 'Guard the empty case.',
    ...overrides,
  };
}

test('high confidence + complete gate fields -> inline (default high strictness)', () => {
  const res = evaluateFinding(complete(), { strictness: 'high' });
  assert.equal(res.route, 'inline');
});

test('medium confidence -> summarize at default high strictness', () => {
  const res = evaluateFinding(complete({ confidence: 'medium' }), { strictness: 'high' });
  assert.equal(res.route, 'summarize');
});

test('low confidence -> drop at default high strictness', () => {
  const res = evaluateFinding(complete({ confidence: 'low' }), { strictness: 'high' });
  assert.equal(res.route, 'drop');
});

test('high confidence but missing failureMode -> not inline (summarize)', () => {
  const res = evaluateFinding(complete({ failureMode: '' }), { strictness: 'high' });
  assert.equal(res.route, 'summarize');
  assert.ok(res.reasons.some((r) => r.includes('failureMode')));
});

test('high confidence but missing evidence -> not inline', () => {
  const res = evaluateFinding(complete({ evidence: '   ' }), { strictness: 'high' });
  assert.equal(res.route, 'summarize');
  assert.ok(res.reasons.some((r) => r.includes('evidence')));
});

test('high confidence but missing fixDirection -> not inline', () => {
  const res = evaluateFinding(complete({ fixDirection: undefined }), { strictness: 'high' });
  assert.equal(res.route, 'summarize');
  assert.ok(res.reasons.some((r) => r.includes('fixDirection')));
});

test('high confidence but dishonest/unknown severity -> not inline', () => {
  const res = evaluateFinding(complete({ severity: 'whatever' }), { strictness: 'high' });
  assert.equal(res.route, 'summarize');
  assert.ok(res.reasons.some((r) => r.includes('severity')));
});

test('missing confidence is treated as not-high -> never inline', () => {
  const f = complete();
  delete f.confidence;
  const res = evaluateFinding(f, { strictness: 'high' });
  assert.notEqual(res.route, 'inline');
});

test('looser low strictness can inline a complete medium-confidence finding', () => {
  const res = evaluateFinding(complete({ confidence: 'medium' }), { strictness: 'low' });
  assert.equal(res.route, 'inline');
});

test('unknown strictness falls back to high (medium summarized)', () => {
  const res = evaluateFinding(complete({ confidence: 'medium' }), { strictness: 'bogus' });
  assert.equal(res.route, 'summarize');
});

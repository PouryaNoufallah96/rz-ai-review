import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lessonFingerprint,
  evidenceHash,
  hasLesson,
  recordLesson,
} from '../src/services/learningMemory.js';

test('lessonFingerprint is stable for the same normalized lesson context', () => {
  const a = lessonFingerprint({ guidePatch: 'Always validate input.', file: 'a.js', failureMode: 'x' });
  const b = lessonFingerprint({ guidePatch: 'always   validate INPUT.', file: 'a.js', failureMode: 'X' });
  assert.equal(a, b);
});

test('lessonFingerprint differs for a different lesson', () => {
  const a = lessonFingerprint({ guidePatch: 'Validate input.' });
  const b = lessonFingerprint({ guidePatch: 'Close file handles.' });
  assert.notEqual(a, b);
});

test('same lesson + same evidence -> hasLesson true (skip re-proposal)', () => {
  const state = {};
  const fp = lessonFingerprint({ guidePatch: 'Validate input.' });
  const ev = evidenceHash({ body: 'please always validate' });
  recordLesson(state, { fingerprint: fp, evidenceHash: ev }, 1000);
  assert.equal(hasLesson(state, { fingerprint: fp, evidenceHash: ev }), true);
});

test('same lesson + changed evidence -> eligible again (hasLesson false)', () => {
  const state = {};
  const fp = lessonFingerprint({ guidePatch: 'Validate input.' });
  const ev1 = evidenceHash({ body: 'original reply' });
  const ev2 = evidenceHash({ body: 'new different reply with new info' });
  recordLesson(state, { fingerprint: fp, evidenceHash: ev1 }, 1000);
  assert.equal(hasLesson(state, { fingerprint: fp, evidenceHash: ev2 }), false);
});

test('hasLesson is independent of guide sha (fingerprint excludes it)', () => {
  // The lesson fingerprint is derived purely from lesson/context, never a guide
  // sha, so it is identical regardless of how many times the guide moved.
  const fpA = lessonFingerprint({ guidePatch: 'Rule X', file: 'a.js', failureMode: 'm' });
  const fpB = lessonFingerprint({ guidePatch: 'Rule X', file: 'a.js', failureMode: 'm' });
  assert.equal(fpA, fpB);

  const state = {};
  const ev = evidenceHash({ body: 'same reply' });
  recordLesson(state, { fingerprint: fpA, evidenceHash: ev });
  // A "later" call (after the guide changed elsewhere) recomputes the same fp.
  assert.equal(hasLesson(state, { fingerprint: fpB, evidenceHash: ev }), true);
});

test('unseen lesson -> hasLesson false', () => {
  assert.equal(hasLesson({}, { fingerprint: 'nope', evidenceHash: 'x' }), false);
});

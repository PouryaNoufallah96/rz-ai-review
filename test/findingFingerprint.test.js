import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprint,
  affectedCodeHash,
  hunkForLine,
} from '../src/services/findingFingerprint.js';

// A two-hunk diff. New-file lines: hunk A starts at 10, hunk B starts at 80.
const diff = [
  '@@ -10,3 +10,4 @@',
  ' function a() {',
  '+  const x = list[0].id;',
  '   return x;',
  ' }',
  '@@ -80,2 +80,3 @@',
  ' function b() {',
  '+  console.log("noise");',
  ' }',
].join('\n');

test('hunkForLine returns only the hunk containing the line', () => {
  const h = hunkForLine(diff, 11); // inside hunk A
  assert.ok(h.includes('const x = list[0].id;'));
  assert.ok(!h.includes('console.log'));
});

test('hunkForLine returns empty for a line in no hunk', () => {
  assert.equal(hunkForLine(diff, 999), '');
});

test('fingerprint is stable for same rule+file+hunk', () => {
  const f = { file: 'src/a.js', line: 11, failureMode: 'null deref' };
  const a = fingerprint(f, { diff });
  const b = fingerprint(f, { diff });
  assert.equal(a, b);
});

test('fingerprint differs when failureMode differs', () => {
  const base = { file: 'src/a.js', line: 11, failureMode: 'null deref' };
  const other = { file: 'src/a.js', line: 11, failureMode: 'off by one' };
  assert.notEqual(fingerprint(base, { diff }), fingerprint(other, { diff }));
});

test('fingerprint differs when file differs', () => {
  const a = fingerprint({ file: 'src/a.js', line: 11, failureMode: 'x' }, { diff });
  const b = fingerprint({ file: 'src/b.js', line: 11, failureMode: 'x' }, { diff });
  assert.notEqual(a, b);
});

test('fingerprint differs when changed code in the hunk differs', () => {
  const changed = diff.replace('const x = list[0].id;', 'const x = list.at(0)?.id;');
  const f = { file: 'src/a.js', line: 11, failureMode: 'null deref' };
  assert.notEqual(fingerprint(f, { diff }), fingerprint(f, { diff: changed }));
});

test('hunk-based: noise outside the finding hunk does NOT change the fingerprint', () => {
  // Change only hunk B; finding is anchored in hunk A (line 11).
  const noisy = diff.replace('console.log("noise");', 'console.log("totally different");');
  const f = { file: 'src/a.js', line: 11, failureMode: 'null deref' };
  assert.equal(fingerprint(f, { diff }), fingerprint(f, { diff: noisy }));
});

test('affectedCodeHash changes when the hunk code changes, stable otherwise', () => {
  const a = affectedCodeHash({ diff, line: 11 });
  const same = affectedCodeHash({ diff, line: 11 });
  assert.equal(a, same);
  const changed = diff.replace('const x = list[0].id;', 'const x = list.at(0)?.id;');
  assert.notEqual(a, affectedCodeHash({ diff: changed, line: 11 }));
});

test('rule id takes precedence over failureMode for identity', () => {
  const withRule = { file: 'src/a.js', line: 11, rule: 'R3', failureMode: 'whatever' };
  const sameRuleDiffMode = { file: 'src/a.js', line: 11, rule: 'R3', failureMode: 'different' };
  assert.equal(fingerprint(withRule, { diff }), fingerprint(sameRuleDiffMode, { diff }));
});

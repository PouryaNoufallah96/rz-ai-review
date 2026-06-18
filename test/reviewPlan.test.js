import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planFindings } from '../src/services/reviewPlan.js';

const diff = [
  '@@ -10,3 +10,4 @@',
  ' function a() {',
  '+  const x = list[0].id;',
  '   return x;',
  ' }',
].join('\n');

const diffByFile = new Map([
  ['src/a.js', { new_path: 'src/a.js', old_path: 'src/a.js', diff }],
]);
const commentableMap = new Map([['src/a.js', new Set([10, 11, 12, 13])]]);

function finding(overrides = {}) {
  return {
    file: 'src/a.js',
    line: 11,
    severity: 'major',
    confidence: 'high',
    failureMode: 'null deref when list is empty',
    evidence: '+  const x = list[0].id;',
    fixDirection: 'guard empty list',
    body: 'Guard the empty case.',
    ...overrides,
  };
}

test('routes inline / summarize / drop by gate', () => {
  const plan = planFindings({
    comments: [
      finding(), // inline
      finding({ line: 12, confidence: 'medium' }), // summarize
      finding({ line: 13, confidence: 'low' }), // drop
    ],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });
  assert.equal(plan.inline.length, 1);
  assert.equal(plan.summarize.length, 1);
  assert.equal(plan.drop.length, 1);
});

test('in-run redundancy collapses same fingerprint to one, keeping highest severity', () => {
  const plan = planFindings({
    comments: [
      finding({ severity: 'minor' }),
      finding({ severity: 'blocker' }), // same line/file/hunk/failureMode -> same fingerprint
    ],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });
  assert.equal(plan.inline.length, 1, 'collapsed to a single finding');
  assert.equal(plan.redundant, 1, 'one redundant collapse counted');
  assert.equal(plan.inline[0].finding.severity, 'blocker', 'kept highest severity');
});

test('non-commentable line is dropped', () => {
  const plan = planFindings({
    comments: [finding({ line: 999 })],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });
  assert.equal(plan.inline.length, 0);
  assert.equal(plan.drop.length, 1);
});

test('file not in diff is dropped', () => {
  const plan = planFindings({
    comments: [finding({ file: 'src/missing.js' })],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });
  assert.equal(plan.drop.length, 1);
});

test('public Sentry DSN findings are dropped unless a private credential is involved', () => {
  const sentryDsn = finding({
    failureMode: 'Hardcoded Sentry DSN leaks internal project tracking.',
    evidence: '+  const dsn = "https://public@sentry.example/1";',
    fixDirection: 'Remove the hardcoded DSN fallback.',
    body: 'Hardcoded Sentry DSN should not be committed.',
  });
  const sentryToken = finding({
    line: 12,
    failureMode: 'Hardcoded Sentry auth token allows source map upload.',
    evidence: '+  const token = process.env.SENTRY_AUTH_TOKEN || "secret-token";',
    fixDirection: 'Remove the token fallback.',
    body: 'Private auth token is a credential.',
  });

  const plan = planFindings({
    comments: [sentryDsn, sentryToken],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });

  assert.equal(plan.inline.length, 1);
  assert.equal(plan.inline[0].finding, sentryToken);
  assert.equal(plan.drop.length, 1);
  assert.deepEqual(plan.drop[0].reasons, ['public telemetry DSN is not a credential']);
});

test('inline entries carry fingerprint + codeHash for Review Memory', () => {
  const plan = planFindings({
    comments: [finding()],
    commentableMap,
    diffByFile,
    strictness: 'high',
  });
  assert.equal(typeof plan.inline[0].fingerprint, 'string');
  assert.equal(typeof plan.inline[0].codeHash, 'string');
});

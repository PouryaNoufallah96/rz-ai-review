import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Temp DB_PATH + dummy credentials BEFORE importing the store so the env-validated
// config does not exit and metrics persist to a throwaway file (no network).
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rz-metrics-')), 'state.json');
process.env.DB_PATH = tmpDb;
process.env.GITLAB_HOST ??= 'https://gitlab.example.com';
process.env.GITLAB_TOKEN ??= 'x';
process.env.GITLAB_BOT_USERNAME ??= 'bot';
process.env.AI_BASE_URL ??= 'https://ai.example.com';
process.env.AI_API_KEY ??= 'x';
process.env.AI_MODEL ??= 'm';

const { store } = await import('../src/db/index.js');

test('recordReviewMetrics increments runs, verdict, and routing counters', () => {
  store.recordReviewMetrics({
    verdict: 'issues-found',
    breakdown: { posted: 2, summarized: 1, dropped: 3, redundant: 1, duplicate: 0 },
  });
  store.recordReviewMetrics({
    verdict: 'approved',
    breakdown: { posted: 0, summarized: 0, dropped: 1 },
  });

  const m = store.getReviewMetrics();
  assert.equal(m.runs, 2);
  assert.equal(m.verdicts['issues-found'], 1);
  assert.equal(m.verdicts.approved, 1);
  assert.equal(m.routing.posted, 2);
  assert.equal(m.routing.summarized, 1);
  assert.equal(m.routing.dropped, 4); // 3 + 1
  assert.equal(m.routing.redundant, 1);
  assert.equal(m.routing.duplicate, 0);
});

test('recordReviewMetrics is tolerant of a missing breakdown', () => {
  const before = store.getReviewMetrics();
  store.recordReviewMetrics({ verdict: 'skipped' });
  const after = store.getReviewMetrics();
  assert.equal(after.runs, before.runs + 1);
  assert.equal(after.verdicts.skipped, before.verdicts.skipped + 1);
  // routing untouched when no breakdown supplied.
  assert.deepEqual(after.routing, before.routing);
});

test('recordReviewMetrics ignores unknown verdicts but still counts the run', () => {
  const before = store.getReviewMetrics();
  store.recordReviewMetrics({ verdict: 'totally-unknown' });
  const after = store.getReviewMetrics();
  assert.equal(after.runs, before.runs + 1);
  assert.deepEqual(after.verdicts, before.verdicts);
});

test('getReviewMetrics returns copies (not internal references)', () => {
  const a = store.getReviewMetrics();
  a.routing.posted = 9999;
  const b = store.getReviewMetrics();
  assert.notEqual(b.routing.posted, 9999);
});

test('review metrics persist to the temp DB file', () => {
  store.flush();
  const raw = JSON.parse(fs.readFileSync(tmpDb, 'utf8'));
  assert.ok(raw.review_metrics, 'review_metrics persisted');
  assert.equal(typeof raw.review_metrics.runs, 'number');
  assert.ok(raw.review_metrics.verdicts);
  assert.ok(raw.review_metrics.routing);
});

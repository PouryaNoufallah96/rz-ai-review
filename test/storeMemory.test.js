import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Provide a temp DB_PATH and dummy credentials BEFORE importing the store, so the
// env-validated config does not exit and Review/Learning Memory persist to a
// throwaway file (no network).
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rz-store-')), 'state.json');
process.env.DB_PATH = tmpDb;
process.env.GITLAB_HOST ??= 'https://gitlab.example.com';
process.env.GITLAB_TOKEN ??= 'x';
process.env.GITLAB_BOT_USERNAME ??= 'bot';
process.env.AI_BASE_URL ??= 'https://ai.example.com';
process.env.AI_API_KEY ??= 'x';
process.env.AI_MODEL ??= 'm';

const { store } = await import('../src/db/index.js');

test('store: Review Memory duplicate detection on a temp DB_PATH', () => {
  store.recordFinding({ fingerprint: 'sfp1', codeHash: 'c1', file: 'a.js', severity: 'major' });
  assert.equal(store.isDuplicateFinding({ fingerprint: 'sfp1', codeHash: 'c1' }), true);
  // material code change -> reviewable again
  assert.equal(store.isDuplicateFinding({ fingerprint: 'sfp1', codeHash: 'c2' }), false);
  // unseen fingerprint -> not duplicate
  assert.equal(store.isDuplicateFinding({ fingerprint: 'unseen', codeHash: 'c1' }), false);
  const rec = store.getFinding('sfp1');
  assert.equal(rec.fingerprint, 'sfp1');
});

test('store: Learning Memory skip on same lesson+evidence, eligible on changed evidence', () => {
  store.recordLesson({ fingerprint: 'lfp1', evidenceHash: 'e1', mrIid: 5 });
  assert.equal(store.hasLesson({ fingerprint: 'lfp1', evidenceHash: 'e1' }), true);
  assert.equal(store.hasLesson({ fingerprint: 'lfp1', evidenceHash: 'e2' }), false);
  assert.equal(store.hasLesson({ fingerprint: 'lfp-unseen', evidenceHash: 'e1' }), false);
});

test('store: memory persists to the temp DB file', () => {
  store.flush();
  const raw = JSON.parse(fs.readFileSync(tmpDb, 'utf8'));
  assert.ok(raw.review_memory.sfp1, 'review_memory persisted');
  assert.ok(raw.learning_memory.lfp1, 'learning_memory persisted');
});

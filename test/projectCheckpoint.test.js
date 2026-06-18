import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  classifyFile,
  isCheckpointTrackable,
  writeCheckpoint,
  CHECKPOINT_FILE,
} from '../src/services/projectCheckpoint.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rz-checkpoint-'));
}

function readCheckpoint(root) {
  return JSON.parse(fs.readFileSync(path.join(root, CHECKPOINT_FILE), 'utf8'));
}

test('classifyFile labels files by role', () => {
  assert.equal(classifyFile('src/services/reviewer.js'), 'source');
  assert.equal(classifyFile('docs/REVIEW_GUIDE.md'), 'doc');
  assert.equal(classifyFile('package.json'), 'config');
  assert.equal(classifyFile('test/reviewer.test.js'), 'test');
  assert.equal(classifyFile('tests/foo.js'), 'test');
  assert.equal(classifyFile('public/logo.png'), 'asset');
  assert.equal(classifyFile('Makefile'), 'other');
  assert.equal(classifyFile('.env.example'), 'config');
});

test('isCheckpointTrackable drops machine-local artifacts', () => {
  assert.equal(isCheckpointTrackable('src/x.js'), true);
  assert.equal(isCheckpointTrackable('.DS_Store'), false);
  assert.equal(isCheckpointTrackable('nested/.DS_Store'), false);
  assert.equal(isCheckpointTrackable('out/run.log'), false);
  assert.equal(isCheckpointTrackable('.env'), false);
  assert.equal(isCheckpointTrackable('.env.local'), false);
  assert.equal(isCheckpointTrackable('.env.production'), false);
  assert.equal(isCheckpointTrackable('.env.example'), true);
});

test('writeCheckpoint is metadata-only and contains no source content', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'secret.js'), 'const TOKEN = "super-secret-value";');
  const res = writeCheckpoint(root, {
    files: ['secret.js'],
    contexts: ['backend'],
    generatedDocFingerprints: { 'docs/REVIEW_GUIDE.md': 'abc' },
  });
  assert.equal(res.status, 'created');

  const raw = fs.readFileSync(path.join(root, CHECKPOINT_FILE), 'utf8');
  assert.ok(!raw.includes('super-secret-value'), 'checkpoint must not embed source content');

  const cp = readCheckpoint(root);
  assert.equal(cp.version, 1);
  assert.deepEqual(Object.keys(cp.files['secret.js']).sort(), ['classification', 'hash']);
  assert.deepEqual(cp.contexts, ['backend']);
  assert.deepEqual(cp.generatedDocs, { 'docs/REVIEW_GUIDE.md': 'abc' });
});

test('writeCheckpoint output is deterministic regardless of input order', () => {
  const rootA = tmpRoot();
  const rootB = tmpRoot();
  for (const root of [rootA, rootB]) {
    fs.writeFileSync(path.join(root, 'a.js'), 'a');
    fs.writeFileSync(path.join(root, 'b.js'), 'b');
  }
  writeCheckpoint(rootA, {
    files: ['a.js', 'b.js'],
    contexts: ['backend', 'architecture'],
    generatedDocFingerprints: { 'z.md': '1', 'a.md': '2' },
  });
  writeCheckpoint(rootB, {
    files: ['b.js', 'a.js'],
    contexts: ['architecture', 'backend'],
    generatedDocFingerprints: { 'a.md': '2', 'z.md': '1' },
  });
  const a = fs.readFileSync(path.join(rootA, CHECKPOINT_FILE), 'utf8');
  const b = fs.readFileSync(path.join(rootB, CHECKPOINT_FILE), 'utf8');
  assert.equal(a, b, 'checkpoint must be byte-identical for equivalent inputs');
});

test('writeCheckpoint reports unchanged on a repeated identical run', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'a.js'), 'a');
  const input = { files: ['a.js'], contexts: [], generatedDocFingerprints: {} };
  assert.equal(writeCheckpoint(root, input).status, 'created');
  assert.equal(writeCheckpoint(root, input).status, 'unchanged');
});

test('checkpoint has no wall-clock timestamp fields', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'a.js'), 'a');
  writeCheckpoint(root, { files: ['a.js'], contexts: [], generatedDocFingerprints: {} });
  const raw = fs.readFileSync(path.join(root, CHECKPOINT_FILE), 'utf8');
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw), 'no ISO timestamps allowed');
  assert.ok(!/"(generatedAt|timestamp|createdAt|updatedAt)"/.test(raw), 'no time fields');
});

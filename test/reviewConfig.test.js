import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultReviewConfig,
  writeReviewConfig,
  REVIEW_CONFIG_FILE,
} from '../src/services/reviewConfig.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rz-config-'));
}

function readConfig(root) {
  return JSON.parse(fs.readFileSync(path.join(root, REVIEW_CONFIG_FILE), 'utf8'));
}

test('default Review Config defaults to high strictness and disabled automation', () => {
  const cfg = defaultReviewConfig({ projectKinds: [], stack: [] });
  assert.equal(cfg.version, 1);
  assert.equal(cfg.strictness, 'high');
  assert.equal(cfg.automation.enabled, false);
  assert.deepEqual(cfg.automation.targetBranchPolicy, []);
  assert.deepEqual(cfg.confidence, { inline: 'high', summarize: 'medium', drop: 'low' });
  assert.deepEqual(cfg.paths, {
    guide: 'docs/REVIEW_GUIDE.md',
    index: 'docs/REVIEW_INDEX.md',
    contextDir: 'docs/review',
  });
});

test('Instruction Packs are inferred from the scan and stay sorted', () => {
  const backend = defaultReviewConfig({ projectKinds: ['HTTP service'], stack: [] });
  assert.deepEqual(backend.instructionPacks, ['backend', 'baseline']);
  const both = defaultReviewConfig({
    projectKinds: ['CLI'],
    stack: ['React/Next frontend'],
  });
  assert.deepEqual(both.instructionPacks, ['backend', 'baseline', 'frontend']);
});

test('writeReviewConfig creates the file when missing', () => {
  const root = tmpRoot();
  const res = writeReviewConfig(root, { projectKinds: [], stack: [] });
  assert.equal(res.status, 'created');
  assert.equal(readConfig(root).strictness, 'high');
});

test('writeReviewConfig never clobbers human-edited values and adds missing keys', () => {
  const root = tmpRoot();
  writeReviewConfig(root, { projectKinds: [], stack: [] });

  const cfg = readConfig(root);
  cfg.strictness = 'low';
  cfg.confidence.inline = 'medium';
  cfg.myCustomFlag = true;
  delete cfg.automation;
  fs.writeFileSync(path.join(root, REVIEW_CONFIG_FILE), JSON.stringify(cfg, null, 2));

  const res = writeReviewConfig(root, { projectKinds: [], stack: [] });
  assert.equal(res.status, 'updated');

  const merged = readConfig(root);
  assert.equal(merged.strictness, 'low', 'human strictness preserved');
  assert.equal(merged.confidence.inline, 'medium', 'nested human value preserved');
  assert.equal(merged.myCustomFlag, true, 'human-added key preserved');
  assert.deepEqual(
    merged.automation,
    { enabled: false, targetBranchPolicy: [] },
    'missing default re-added',
  );
});

test('writeReviewConfig reports unchanged when all defaults are present', () => {
  const root = tmpRoot();
  writeReviewConfig(root, { projectKinds: [], stack: [] });
  const res = writeReviewConfig(root, { projectKinds: [], stack: [] });
  assert.equal(res.status, 'unchanged');
});

test('writeReviewConfig does not clobber an unparseable existing config', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, REVIEW_CONFIG_FILE), 'not json {');
  const res = writeReviewConfig(root, { projectKinds: [], stack: [] });
  assert.equal(res.status, 'skipped-existing-unmanaged');
  assert.equal(fs.readFileSync(path.join(root, REVIEW_CONFIG_FILE), 'utf8'), 'not json {');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setupProjectReview } from '../src/services/projectSetup.js';
import { CHECKPOINT_FILE, diffCheckpoint } from '../src/services/projectCheckpoint.js';

const HUMAN_START = '<!-- rz-review:human:start -->';
const HUMAN_END = '<!-- rz-review:human:end -->';
const GENERATED_START = '<!-- rz-review:generated:start -->';
const GENERATED_END = '<!-- rz-review:generated:end -->';

function tmpProject({ name = 'demo', deps = { fastify: '4' } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-refresh-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, dependencies: deps }),
  );
  fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'routes', 'api.js'), 'export default 1;\n');
  return root;
}

function statusOf(result, relPath) {
  return result.files.find((f) => f.path === relPath)?.status;
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function injectHumanNote(root, rel, note) {
  const content = read(root, rel);
  const start = content.indexOf(HUMAN_START);
  const end = content.indexOf(HUMAN_END);
  assert.ok(start !== -1 && end !== -1, `${rel} must have a human block`);
  const before = content.slice(0, start + HUMAN_START.length);
  const after = content.slice(end);
  fs.writeFileSync(path.join(root, rel), `${before}\n${note}\n${after}`);
}

function generatedBlockOf(content) {
  return content.slice(
    content.indexOf(GENERATED_START) + GENERATED_START.length,
    content.indexOf(GENERATED_END),
  );
}

test('diffCheckpoint classifies added / changed / removed / unchanged files', () => {
  const prev = {
    files: {
      'a.js': { classification: 'source', hash: 'h-a' },
      'b.js': { classification: 'source', hash: 'h-b' },
      'gone.js': { classification: 'source', hash: 'h-gone' },
    },
  };
  const current = {
    'a.js': { classification: 'source', hash: 'h-a' }, // unchanged
    'b.js': { classification: 'source', hash: 'h-b2' }, // changed
    'new.js': { classification: 'source', hash: 'h-new' }, // added
    // gone.js removed
  };

  const diff = diffCheckpoint(prev, current);
  assert.deepEqual(diff.added, ['new.js']);
  assert.deepEqual(diff.changed, ['b.js']);
  assert.deepEqual(diff.removed, ['gone.js']);
  assert.deepEqual(diff.unchanged, ['a.js']);
});

test('diffCheckpoint treats a null prior checkpoint as everything added', () => {
  const current = {
    'b.js': { hash: 'h-b' },
    'a.js': { hash: 'h-a' },
  };
  const diff = diffCheckpoint(null, current);
  assert.deepEqual(diff.added, ['a.js', 'b.js']); // sorted
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.unchanged, []);
});

test('refresh preserves a human edit while updating the generated block when facts change', () => {
  const root = tmpProject({ name: 'before' });
  setupProjectReview({ targetPath: root, mode: 'setup' });

  const note = 'HUMAN NOTE: never auto-merge release branches.';
  injectHumanNote(root, 'docs/REVIEW_GUIDE.md', note);
  const before = read(root, 'docs/REVIEW_GUIDE.md');
  assert.ok(before.includes('Project: before'), 'generated block should reflect old name');

  // Change a project fact (the name) so the generated block content must change.
  const pkg = JSON.parse(read(root, 'package.json'));
  pkg.name = 'after';
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));

  const result = setupProjectReview({ targetPath: root, mode: 'refresh' });
  const after = read(root, 'docs/REVIEW_GUIDE.md');

  assert.ok(after.includes(note), 'human note must survive refresh');
  assert.ok(after.includes('Project: after'), 'generated block must reflect new name');
  assert.ok(!after.includes('Project: before'), 'stale generated fact must be replaced');
  assert.equal(statusOf(result, 'docs/REVIEW_GUIDE.md'), 'updated');
  assert.ok(result.refresh.regeneratedDocs.includes('docs/REVIEW_GUIDE.md'));
  assert.ok(result.refresh.changedFiles.includes('package.json'));
});

test('refresh is idempotent: second run is byte-identical with all unchanged statuses', () => {
  const root = tmpProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  const cpPath = path.join(root, CHECKPOINT_FILE);

  // First refresh settles the tree (config merge / checkpoint re-list).
  setupProjectReview({ targetPath: root, mode: 'refresh' });
  const firstBytes = fs.readFileSync(cpPath, 'utf8');
  const firstDocs = read(root, 'docs/REVIEW_GUIDE.md');

  const second = setupProjectReview({ targetPath: root, mode: 'refresh' });
  const secondBytes = fs.readFileSync(cpPath, 'utf8');

  assert.equal(firstBytes, secondBytes, 'checkpoint must be byte-identical across refreshes');
  assert.equal(firstDocs, read(root, 'docs/REVIEW_GUIDE.md'), 'docs must be identical');

  for (const f of second.files) {
    assert.equal(f.status, 'unchanged', `${f.path} must be unchanged on a no-op refresh`);
  }
  assert.equal(second.refresh.hadCheckpoint, true);
  assert.deepEqual(second.refresh.changedFiles, []);
  assert.deepEqual(second.refresh.addedFiles, []);
  assert.deepEqual(second.refresh.removedFiles, []);
  assert.deepEqual(second.refresh.regeneratedDocs, []);
  assert.ok(second.refresh.unchangedDocs.includes('docs/REVIEW_GUIDE.md'));
});

test('refresh reports a newly added source file under addedFiles', () => {
  const root = tmpProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  setupProjectReview({ targetPath: root, mode: 'refresh' }); // settle

  fs.writeFileSync(path.join(root, 'src', 'routes', 'extra.js'), 'export default 2;\n');
  const result = setupProjectReview({ targetPath: root, mode: 'refresh' });

  assert.ok(result.refresh.addedFiles.includes('src/routes/extra.js'));
  assert.deepEqual(result.refresh.changedFiles, []);
  assert.deepEqual(result.refresh.removedFiles, []);
});

test('refresh with a changed source file reports it as changed and keeps human blocks intact', () => {
  const root = tmpProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  injectHumanNote(root, 'docs/review/architecture.md', 'HUMAN: storage is single-writer.');
  setupProjectReview({ targetPath: root, mode: 'refresh' }); // settle with human note

  const humanNote = 'HUMAN: storage is single-writer.';
  const beforeGen = generatedBlockOf(read(root, 'docs/review/architecture.md'));

  // Edit an existing tracked source file (content hash changes).
  fs.writeFileSync(path.join(root, 'src', 'routes', 'api.js'), 'export default 999;\n');
  const result = setupProjectReview({ targetPath: root, mode: 'refresh' });

  assert.ok(result.refresh.changedFiles.includes('src/routes/api.js'));
  assert.deepEqual(result.refresh.addedFiles, []);

  const arch = read(root, 'docs/review/architecture.md');
  assert.ok(arch.includes(humanNote), 'human block must remain intact after a source change');
  // Generated architecture facts do not depend on api.js contents, so the
  // generated block content is stable — refresh did not corrupt it.
  assert.equal(generatedBlockOf(arch), beforeGen);
});

test('refresh without a prior checkpoint reports hadCheckpoint false', () => {
  const root = tmpProject();
  // No setup first: refresh on a project that never had a checkpoint.
  const result = setupProjectReview({ targetPath: root, mode: 'refresh' });
  assert.equal(result.refresh.hadCheckpoint, false);
  // Every current trackable file is "added" relative to no prior checkpoint.
  assert.ok(result.refresh.addedFiles.includes('package.json'));
  assert.ok(result.refresh.addedFiles.includes('src/routes/api.js'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setupProjectReview } from '../src/services/projectSetup.js';
import { defaultReviewConfig, REVIEW_CONFIG_FILE } from '../src/services/reviewConfig.js';
import { CHECKPOINT_FILE } from '../src/services/projectCheckpoint.js';
import {
  INSTRUCTION_PACKS,
  compiledDocsForPacks,
  compiledDocsForScan,
} from '../src/defaults/instructionPacks.js';

const HUMAN_START = '<!-- rz-review:human:start -->';
const HUMAN_END = '<!-- rz-review:human:end -->';
const GENERATED_START = '<!-- rz-review:generated:start -->';
const GENERATED_END = '<!-- rz-review:generated:end -->';

// Backend-only Target Project: an HTTP service with no frontend signals, so the
// frontend pack must NOT be selected and frontend.md must NOT be compiled.
function backendOnlyProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-pack-be-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'backend-only', dependencies: { fastify: '4' } }),
  );
  fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'routes', 'api.js'), 'export default 1;\n');
  return root;
}

// Frontend-capable Target Project: React/Next plus static assets, so the
// frontend pack is selected and frontend.md must be compiled.
function frontendProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-pack-fe-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'frontend-app', dependencies: { react: '18', next: '14' } }),
  );
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<!doctype html>\n');
  return root;
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function generatedBlockOf(content) {
  return content.slice(
    content.indexOf(GENERATED_START) + GENERATED_START.length,
    content.indexOf(GENERATED_END),
  );
}

test('the baseline pack always compiles the separated context docs', () => {
  const baseline = INSTRUCTION_PACKS.find((p) => p.id === 'baseline');
  const relPaths = baseline.docs.map((d) => d.relPath);
  assert.deepEqual(relPaths, [
    'docs/review/architecture.md',
    'docs/review/conventions.md',
    'docs/review/testing.md',
    'docs/review/security.md',
    'docs/review/workflows.md',
    'docs/review/domain.md',
    'docs/review/risk-map.md',
  ]);
});

test('compiledDocsForPacks returns docs only for selected packs, in registry order', () => {
  const baselineOnly = compiledDocsForPacks(['baseline']).map((d) => d.relPath);
  assert.ok(baselineOnly.includes('docs/review/security.md'));
  assert.ok(!baselineOnly.includes('docs/review/backend.md'));
  assert.ok(!baselineOnly.includes('docs/review/frontend.md'));

  const withBackend = compiledDocsForPacks(['baseline', 'backend']).map((d) => d.relPath);
  assert.ok(withBackend.includes('docs/review/backend.md'));
  assert.ok(!withBackend.includes('docs/review/frontend.md'));

  // Unknown pack ids are ignored.
  assert.deepEqual(compiledDocsForPacks(['nope']), []);
});

test('compiledDocsForScan agrees with the inferred Instruction Packs in config', () => {
  const beScan = { projectKinds: ['HTTP service'], stack: [] };
  const beDocs = compiledDocsForScan(beScan).map((d) => d.relPath);
  assert.deepEqual(defaultReviewConfig(beScan).instructionPacks, ['backend', 'baseline']);
  assert.ok(beDocs.includes('docs/review/backend.md'));
  assert.ok(!beDocs.includes('docs/review/frontend.md'));
});

test('setup compiles the new separated context docs for a backend project', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  for (const rel of [
    'docs/review/security.md',
    'docs/review/workflows.md',
    'docs/review/domain.md',
    'docs/review/risk-map.md',
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} must be compiled`);
    const content = read(root, rel);
    assert.ok(content.includes(GENERATED_START) && content.includes(GENERATED_END), `${rel} generated block`);
    assert.ok(content.includes(HUMAN_START) && content.includes(HUMAN_END), `${rel} human block`);
  }
});

test('an unselected pack does not produce its doc (no frontend.md for backend-only)', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  assert.ok(fs.existsSync(path.join(root, 'docs/review/backend.md')), 'backend pack selected');
  assert.ok(!fs.existsSync(path.join(root, 'docs/review/frontend.md')), 'frontend pack not selected');

  const cfg = JSON.parse(read(root, REVIEW_CONFIG_FILE));
  assert.ok(cfg.instructionPacks.includes('backend'));
  assert.ok(!cfg.instructionPacks.includes('frontend'));
});

test('a selected frontend pack compiles frontend.md', () => {
  const root = frontendProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  assert.ok(fs.existsSync(path.join(root, 'docs/review/frontend.md')), 'frontend pack selected');
  const cfg = JSON.parse(read(root, REVIEW_CONFIG_FILE));
  assert.ok(cfg.instructionPacks.includes('frontend'));
});

test('Review Index lists exactly the context docs compiled for the selected packs', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  const expected = compiledDocsForScan({
    projectKinds: ['HTTP service'],
    stack: ['Fastify HTTP server', 'Route modules', 'Service modules'],
  }).map((d) => d.relPath);

  const index = read(root, 'docs/REVIEW_INDEX.md');
  const generated = generatedBlockOf(index);
  for (const rel of expected) {
    assert.ok(generated.includes(`- ${rel}`), `index must list ${rel}`);
  }
  // backend-only project: frontend.md must not be listed.
  assert.ok(!generated.includes('- docs/review/frontend.md'));
  assert.ok(generated.includes('- docs/review/backend.md'));
});

test('a human edit inside a new context doc survives refresh', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  const rel = 'docs/review/security.md';
  const note = 'HUMAN: token rotation is owned by ops, not reviewers.';
  const content = read(root, rel);
  const at = content.indexOf(HUMAN_START) + HUMAN_START.length;
  fs.writeFileSync(
    path.join(root, rel),
    `${content.slice(0, at)}\n${note}\n${content.slice(at)}`,
  );

  setupProjectReview({ targetPath: root, mode: 'refresh' });
  const after = read(root, rel);
  assert.ok(after.includes(note), 'human note must survive refresh');
  assert.ok(after.includes(GENERATED_START), 'generated block still present');
});

test('workflows.md documents future workflows clearly marked not enabled', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });

  const wf = generatedBlockOf(read(root, 'docs/review/workflows.md'));
  assert.ok(/Future Workflows/i.test(wf), 'has a Future Workflows section');
  assert.ok(/not enabled/i.test(wf), 'future workflows are marked not enabled');
  for (const term of ['Suggested Fixes', 'Fix Branch', 'Deep Index', 'Command Probe', 'Review Automation']) {
    assert.ok(wf.includes(term), `documents ${term}`);
  }
  assert.ok(/benchmark/i.test(wf), 'documents external reviewer benchmarking');
});

test('defaultReviewConfig exposes future-workflow feature flags, all disabled', () => {
  const cfg = defaultReviewConfig({ projectKinds: [], stack: [] });
  assert.deepEqual(cfg.features, {
    deepIndex: false,
    commandProbe: false,
    fixBranch: false,
    applyFixes: false,
    externalBenchmark: false,
  });
});

test('refresh stays idempotent with the new context docs', () => {
  const root = backendOnlyProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  const cpPath = path.join(root, CHECKPOINT_FILE);

  setupProjectReview({ targetPath: root, mode: 'refresh' }); // settle
  const first = fs.readFileSync(cpPath, 'utf8');
  const result = setupProjectReview({ targetPath: root, mode: 'refresh' });
  const second = fs.readFileSync(cpPath, 'utf8');

  assert.equal(first, second, 'checkpoint must be byte-identical across refreshes');
  for (const f of result.files) {
    assert.equal(f.status, 'unchanged', `${f.path} must be unchanged on a no-op refresh`);
  }
  assert.deepEqual(result.refresh.regeneratedDocs, []);
  // The new docs are tracked as affected contexts in the checkpoint.
  const cp = JSON.parse(second);
  for (const ctx of ['security', 'workflows', 'domain', 'risk-map']) {
    assert.ok(cp.contexts.includes(ctx), `checkpoint contexts include ${ctx}`);
  }
});

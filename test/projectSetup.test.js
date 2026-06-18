import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { setupProjectReview } from '../src/services/projectSetup.js';
import { REVIEW_CONFIG_FILE } from '../src/services/reviewConfig.js';
import { CHECKPOINT_FILE } from '../src/services/projectCheckpoint.js';

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-setup-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { fastify: '4' } }),
  );
  fs.mkdirSync(path.join(root, 'src', 'routes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'routes', 'api.js'), 'export default 1;\n');
  return root;
}

function initGitMetadata(root) {
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# local excludes\n');
}

function initGitRepo(root) {
  execFileSync('git', ['-C', root, 'init'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# local excludes\n');
}

function statusOf(result, relPath) {
  return result.files.find((f) => f.path === relPath)?.status;
}

test('setup writes Review Config and Project Index Checkpoint', () => {
  const root = tmpProject();
  const result = setupProjectReview({ targetPath: root, mode: 'setup' });

  assert.equal(result.ok, true);
  assert.equal(statusOf(result, REVIEW_CONFIG_FILE), 'created');
  assert.equal(statusOf(result, CHECKPOINT_FILE), 'created');
  assert.ok(fs.existsSync(path.join(root, REVIEW_CONFIG_FILE)));
  assert.ok(fs.existsSync(path.join(root, CHECKPOINT_FILE)));
  assert.ok(statusOf(result, 'docs/REVIEW_GUIDE.md'));
});

test('setup defaults to shared review files for team use', () => {
  const root = tmpProject();
  initGitMetadata(root);

  const result = setupProjectReview({ targetPath: root, mode: 'setup' });
  const exclude = fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');

  assert.equal(result.visibility, 'shared');
  assert.equal(statusOf(result, '.git/info/exclude'), undefined);
  assert.ok(!exclude.includes('/.rz-review/'));
  assert.ok(!exclude.includes('/docs/REVIEW_GUIDE.md'));
});

test('setup can protect generated review files for local scratch use', () => {
  const root = tmpProject();
  initGitMetadata(root);

  const result = setupProjectReview({ targetPath: root, mode: 'setup', localOnly: true });
  const exclude = fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8');

  assert.equal(result.visibility, 'local');
  assert.equal(statusOf(result, '.git/info/exclude'), 'updated');
  for (const pattern of [
    '/.rz-review/',
    '/.rz-review.json',
    '/docs/REVIEW_GUIDE.md',
    '/docs/REVIEW_INDEX.md',
    '/docs/review/',
  ]) {
    assert.ok(exclude.includes(pattern), `${pattern} must be excluded`);
  }

  const second = setupProjectReview({ targetPath: root, mode: 'refresh', localOnly: true });
  assert.equal(statusOf(second, '.git/info/exclude'), 'unchanged');
});

test('refresh after setup is idempotent (checkpoint byte-identical)', () => {
  const root = tmpProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  const cpPath = path.join(root, CHECKPOINT_FILE);

  setupProjectReview({ targetPath: root, mode: 'refresh' });
  const first = fs.readFileSync(cpPath, 'utf8');
  const second = (() => {
    const res = setupProjectReview({ targetPath: root, mode: 'refresh' });
    assert.equal(statusOf(res, CHECKPOINT_FILE), 'unchanged');
    return fs.readFileSync(cpPath, 'utf8');
  })();

  assert.equal(first, second, 'two refreshes must produce identical checkpoints');
});

test('setup never overwrites an unmanaged existing doc', () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const guidePath = path.join(root, 'docs', 'REVIEW_GUIDE.md');
  fs.writeFileSync(guidePath, '# Hand-written guide with no managed block\n');

  const result = setupProjectReview({ targetPath: root, mode: 'setup' });
  assert.equal(statusOf(result, 'docs/REVIEW_GUIDE.md'), 'skipped-existing-unmanaged');
  assert.equal(
    fs.readFileSync(guidePath, 'utf8'),
    '# Hand-written guide with no managed block\n',
  );
});

test('checkpoint records affected contexts and generated-doc fingerprints', () => {
  const root = tmpProject();
  setupProjectReview({ targetPath: root, mode: 'setup' });
  const cp = JSON.parse(fs.readFileSync(path.join(root, CHECKPOINT_FILE), 'utf8'));
  assert.ok(cp.contexts.includes('architecture'));
  assert.ok(cp.generatedDocs['docs/REVIEW_GUIDE.md']);
  assert.ok(cp.generatedDocs['docs/REVIEW_INDEX.md']);
});

test('setup scans application code instead of private AI tooling directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rz-setup-fullstack-'));
  initGitRepo(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'frontend-app',
      dependencies: { next: '16', react: '19' },
      scripts: { validate: 'pnpm typecheck && pnpm build' },
    }),
  );
  fs.mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
  for (let i = 0; i < 1300; i += 1) {
    fs.writeFileSync(path.join(root, '.agents', 'skills', `skill-${i}.md`), '# private\n');
  }
  fs.mkdirSync(path.join(root, 'docs', 'goals', 'local-plan'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'goals', 'local-plan', 'state.md'), '# private\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# private\n');
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '/AGENTS.md\n');
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app', 'page.tsx'), 'export default function Page() { return null; }\n');
  fs.mkdirSync(path.join(root, 'src', 'app', 'rpc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app', 'rpc', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');

  const result = setupProjectReview({ targetPath: root, mode: 'setup' });
  const index = fs.readFileSync(path.join(root, 'docs', 'REVIEW_INDEX.md'), 'utf8');
  const cfg = JSON.parse(fs.readFileSync(path.join(root, REVIEW_CONFIG_FILE), 'utf8'));

  assert.equal(result.ok, true);
  assert.ok(index.includes('- TypeScript React: 1 files'));
  assert.ok(index.includes('- src'));
  assert.ok(!index.includes('- .agents'));
  assert.ok(!index.includes('docs/goals'));
  assert.ok(!index.includes('AGENTS.md'));
  assert.ok(result.summary.stack.includes('Route modules'));
  assert.ok(cfg.instructionPacks.includes('backend'));
  assert.ok(cfg.instructionPacks.includes('frontend'));
});

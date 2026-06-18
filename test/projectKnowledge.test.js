import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadProjectKnowledge,
  assembleKnowledgePrompt,
  CONTEXT_DOCS_BUDGET_BYTES,
  REVIEW_CONFIG_FILE,
} from '../src/services/projectKnowledge.js';

// Build an injectable fetchFile mock from a { path -> {content, sha} } map.
// Returns null for any path not present (the getFileContent 404 contract).
function mockFetch(files) {
  return async ({ filePath }) => files[filePath] ?? null;
}

const GUIDE_PATH = 'docs/REVIEW_GUIDE.md';
const INDEX_PATH = 'docs/REVIEW_INDEX.md';

function ctxPath(name, dir = 'docs/review') {
  return `${dir}/${name}.md`;
}

test('loadProjectKnowledge returns guide + index + existing context docs, omits 404s', async () => {
  const files = {
    [GUIDE_PATH]: { content: '# guide', sha: 'g1' },
    [INDEX_PATH]: { content: '# index', sha: 'i1' },
    [ctxPath('architecture')]: { content: 'arch', sha: 'a1' },
    [ctxPath('security')]: { content: 'sec', sha: 's1' },
    // testing/conventions/etc intentionally absent => skipped
  };
  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(files),
  });

  assert.equal(k.hasGuide, true);
  assert.equal(k.hasKnowledge, true);
  assert.deepEqual(k.guide, { content: '# guide', sha: 'g1' });
  assert.deepEqual(k.index, { content: '# index', sha: 'i1' });

  const names = k.contextDocs.map((d) => d.name);
  assert.deepEqual(names, ['architecture', 'security']);
  assert.ok(!names.includes('testing'), 'absent docs are omitted');
  assert.equal(k.config, null, 'no .rz-review.json => null config');
  assert.equal(k.strictness, 'high', 'safe default strictness');
});

test('loadProjectKnowledge sets hasGuide:false when the guide 404s', async () => {
  const files = {
    [INDEX_PATH]: { content: '# index', sha: 'i1' },
    [ctxPath('architecture')]: { content: 'arch', sha: 'a1' },
  };
  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(files),
  });

  assert.equal(k.hasGuide, false);
  assert.equal(k.guide, null);
  // index + a context doc still exist, so there is *some* knowledge.
  assert.equal(k.hasKnowledge, true);
});

test('hasKnowledge is false when nothing exists', async () => {
  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch({}),
  });
  assert.equal(k.hasGuide, false);
  assert.equal(k.hasKnowledge, false);
  assert.deepEqual(k.contextDocs, []);
});

test('loadProjectKnowledge honors config.paths overrides from .rz-review.json', async () => {
  const customGuide = 'review/GUIDE.md';
  const customIndex = 'review/INDEX.md';
  const customDir = 'review/ctx';
  const reviewConfig = {
    version: 1,
    strictness: 'medium',
    paths: { guide: customGuide, index: customIndex, contextDir: customDir },
  };
  const files = {
    [REVIEW_CONFIG_FILE]: { content: JSON.stringify(reviewConfig), sha: 'c1' },
    [customGuide]: { content: '# custom guide', sha: 'g1' },
    [customIndex]: { content: '# custom index', sha: 'i1' },
    [ctxPath('domain', customDir)]: { content: 'dom', sha: 'd1' },
    // A doc at the DEFAULT path must NOT be picked up.
    [GUIDE_PATH]: { content: '# default guide', sha: 'gx' },
  };

  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(files),
  });

  assert.equal(k.guide.content, '# custom guide', 'uses overridden guide path');
  assert.equal(k.index.content, '# custom index', 'uses overridden index path');
  assert.equal(k.strictness, 'medium', 'strictness from config');
  assert.deepEqual(k.config, reviewConfig);
  assert.deepEqual(k.paths, {
    guide: customGuide,
    index: customIndex,
    contextDir: customDir,
  });
  assert.deepEqual(
    k.contextDocs.map((d) => d.name),
    ['domain'],
    'context docs resolved from overridden dir',
  );
});

test('an unparseable .rz-review.json falls back to safe defaults', async () => {
  const files = {
    [REVIEW_CONFIG_FILE]: { content: 'not json {', sha: 'c1' },
    [GUIDE_PATH]: { content: '# guide', sha: 'g1' },
  };
  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(files),
  });
  assert.equal(k.config, null, 'parse failure => null config');
  assert.equal(k.strictness, 'high', 'safe default strictness');
  assert.equal(k.guide.content, '# guide', 'default guide path used');
});

test('over-budget context docs are dropped largest-first; guide + index retained', async () => {
  // Two big docs that together exceed the budget; one small doc that fits.
  const big = 'x'.repeat(CONTEXT_DOCS_BUDGET_BYTES); // each alone ~= budget
  const files = {
    [GUIDE_PATH]: { content: '# guide', sha: 'g1' },
    [INDEX_PATH]: { content: '# index', sha: 'i1' },
    [ctxPath('architecture')]: { content: big, sha: 'a1' },
    [ctxPath('security')]: { content: big, sha: 's1' },
    [ctxPath('testing')]: { content: 'small', sha: 't1' },
  };

  const k = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(files),
  });

  // Guide + index always present.
  assert.ok(k.guide && k.index, 'guide + index retained');
  // Three docs existed; budget forces dropping the big ones, the small survives.
  const names = k.contextDocs.map((d) => d.name);
  assert.ok(names.length < 3, 'some context docs were dropped for budget');
  assert.ok(names.includes('testing'), 'the small doc survives');
  assert.ok(!names.includes('architecture'), 'a large doc was dropped');

  const total = k.contextDocs.reduce(
    (sum, d) => sum + Buffer.byteLength(d.content, 'utf8'),
    0,
  );
  assert.ok(total <= CONTEXT_DOCS_BUDGET_BYTES, 'kept docs fit the budget');
});

test('assembleKnowledgePrompt is pure and includes guide/index/context sections', () => {
  const knowledge = {
    guide: { content: 'GUIDE BODY', sha: 'g' },
    index: { content: 'INDEX BODY', sha: 'i' },
    contextDocs: [
      { name: 'architecture', content: 'ARCH BODY', sha: 'a' },
      { name: 'security', content: 'SEC BODY', sha: 's' },
    ],
  };

  const out = assembleKnowledgePrompt(knowledge);
  assert.ok(out.includes('# REVIEW_GUIDE\nGUIDE BODY'));
  assert.ok(out.includes('# REVIEW_INDEX\nINDEX BODY'));
  assert.ok(out.includes('# CONTEXT: architecture\nARCH BODY'));
  assert.ok(out.includes('# CONTEXT: security\nSEC BODY'));
  // No conservative instruction when context docs are present.
  assert.ok(!/Limited project context/i.test(out));

  // Deterministic: same input => identical output.
  assert.equal(out, assembleKnowledgePrompt(knowledge));

  // Section order: guide, then index, then context docs.
  assert.ok(
    out.indexOf('# REVIEW_GUIDE') <
      out.indexOf('# REVIEW_INDEX') &&
      out.indexOf('# REVIEW_INDEX') < out.indexOf('# CONTEXT: architecture'),
    'sections are ordered guide -> index -> context',
  );
});

test('assembleKnowledgePrompt emits a conservative instruction when context docs are absent', () => {
  const knowledge = {
    guide: { content: 'GUIDE BODY', sha: 'g' },
    index: { content: 'INDEX BODY', sha: 'i' },
    contextDocs: [],
  };
  const out = assembleKnowledgePrompt(knowledge);
  assert.ok(out.includes('# REVIEW_GUIDE\nGUIDE BODY'));
  assert.ok(
    /Limited project context available/i.test(out),
    'thin context => conservative instruction',
  );
  assert.ok(/do not speculate/i.test(out));
});

test('knowledgeSha changes when any loaded doc changes and is stable when unchanged', async () => {
  const baseFiles = () => ({
    [GUIDE_PATH]: { content: '# guide', sha: 'g1' },
    [INDEX_PATH]: { content: '# index', sha: 'i1' },
    [ctxPath('architecture')]: { content: 'arch', sha: 'a1' },
  });

  const k1 = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(baseFiles()),
  });
  const k1b = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(baseFiles()),
  });
  assert.equal(k1.knowledgeSha, k1b.knowledgeSha, 'stable when unchanged');

  // Change a context doc's sha => knowledgeSha must change.
  const changedCtx = baseFiles();
  changedCtx[ctxPath('architecture')] = { content: 'arch v2', sha: 'a2' };
  const k2 = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(changedCtx),
  });
  assert.notEqual(k2.knowledgeSha, k1.knowledgeSha, 'context change invalidates');

  // Change the guide sha => knowledgeSha must change.
  const changedGuide = baseFiles();
  changedGuide[GUIDE_PATH] = { content: '# guide v2', sha: 'g2' };
  const k3 = await loadProjectKnowledge({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch(changedGuide),
  });
  assert.notEqual(k3.knowledgeSha, k1.knowledgeSha, 'guide change invalidates');
});

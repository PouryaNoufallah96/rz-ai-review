import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadReviewConfig,
  REVIEW_CONFIG_FILE,
} from '../src/services/projectKnowledge.js';

function mockFetch(files) {
  return async ({ filePath }) => files[filePath] ?? null;
}

test('loadReviewConfig returns the parsed config when .rz-review.json exists', async () => {
  const cfg = {
    version: 1,
    automation: { enabled: true, targetBranchPolicy: ['main'] },
  };
  const config = await loadReviewConfig({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch({
      [REVIEW_CONFIG_FILE]: { content: JSON.stringify(cfg), sha: 'c1' },
    }),
  });
  assert.deepEqual(config, cfg);
});

test('loadReviewConfig returns null when .rz-review.json is absent', async () => {
  const config = await loadReviewConfig({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch({}),
  });
  assert.equal(config, null);
});

test('loadReviewConfig returns null when .rz-review.json is unparseable', async () => {
  const config = await loadReviewConfig({
    projectId: 1,
    ref: 'main',
    fetchFile: mockFetch({
      [REVIEW_CONFIG_FILE]: { content: 'not json {', sha: 'c1' },
    }),
  });
  assert.equal(config, null);
});

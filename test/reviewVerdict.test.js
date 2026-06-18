import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectVerdict } from '../src/services/reviewVerdict.js';

const richKnowledge = {
  hasGuide: true,
  hasKnowledge: true,
  contextDocs: [{ name: 'architecture' }],
};
const thinKnowledge = {
  hasGuide: true,
  hasKnowledge: false,
  contextDocs: [],
};

test('skipped when there is no guide', () => {
  const { verdict } = selectVerdict({
    inlineCount: 0,
    summarizeCount: 0,
    knowledge: { hasGuide: false },
    reviewableFiles: 3,
  });
  assert.equal(verdict, 'skipped');
});

test('skipped when there are no reviewable files', () => {
  const { verdict } = selectVerdict({
    inlineCount: 0,
    summarizeCount: 0,
    knowledge: richKnowledge,
    reviewableFiles: 0,
  });
  assert.equal(verdict, 'skipped');
});

test('issues-found when at least one inline finding posted', () => {
  const { verdict } = selectVerdict({
    inlineCount: 1,
    summarizeCount: 0,
    knowledge: richKnowledge,
    reviewableFiles: 2,
  });
  assert.equal(verdict, 'issues-found');
});

test('needs-human-review when knowledge thin AND unresolved medium concerns', () => {
  const { verdict } = selectVerdict({
    inlineCount: 0,
    summarizeCount: 2,
    knowledge: thinKnowledge,
    reviewableFiles: 2,
  });
  assert.equal(verdict, 'needs-human-review');
});

test('approved when no inline issues and confident-clean (rich knowledge)', () => {
  const { verdict } = selectVerdict({
    inlineCount: 0,
    summarizeCount: 1,
    knowledge: richKnowledge,
    reviewableFiles: 2,
  });
  assert.equal(verdict, 'approved');
});

test('approved when thin knowledge but no unresolved concerns', () => {
  const { verdict } = selectVerdict({
    inlineCount: 0,
    summarizeCount: 0,
    knowledge: thinKnowledge,
    reviewableFiles: 2,
  });
  assert.equal(verdict, 'approved');
});

test('issues-found precedence beats needs-human-review even with thin knowledge', () => {
  const { verdict } = selectVerdict({
    inlineCount: 1,
    summarizeCount: 5,
    knowledge: thinKnowledge,
    reviewableFiles: 2,
  });
  assert.equal(verdict, 'issues-found');
});

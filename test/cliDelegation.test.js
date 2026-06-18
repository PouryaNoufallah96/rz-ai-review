import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Importing commands.js pulls in the env-validated config (via gitlab.js); set
// dummy credentials + a throwaway DB_PATH so config does not process.exit. No
// network is performed — we only read exports and source text.
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'rz-cli-')),
  'state.json',
);
process.env.GITLAB_HOST ??= 'https://gitlab.example.com';
process.env.GITLAB_TOKEN ??= 'x';
process.env.GITLAB_BOT_USERNAME ??= 'bot';
process.env.AI_BASE_URL ??= 'https://ai.example.com';
process.env.AI_API_KEY ??= 'x';
process.env.AI_MODEL ??= 'm';

// Structural test (no GitLab/network): assert cli.js delegates to the shared
// command service instead of re-implementing review/status/learn/setup logic
// (RZ-56 command alignment). The same commands.js functions back the API route.
const here = path.dirname(fileURLToPath(import.meta.url));
const cliSrc = fs.readFileSync(path.join(here, '../src/cli.js'), 'utf8');

test('cli.js imports the shared commands service', () => {
  assert.match(cliSrc, /from '\.\/services\/commands\.js'/);
  for (const fn of [
    'runReview',
    'runLocalReview',
    'runStatus',
    'runLearn',
    'runSetupReview',
    'runRefreshReview',
  ]) {
    assert.match(cliSrc, new RegExp(`\\b${fn}\\b`), `cli.js uses ${fn}`);
  }
});

test('cli.js does NOT re-implement review/status/learn logic', () => {
  // It must not pull the reviewer/learner/gitlab modules directly anymore — that
  // logic lives in commands.js. (No reviewMergeRequest / maybeLearnFromReply /
  // listDiscussions imports or calls.)
  assert.doesNotMatch(cliSrc, /reviewMergeRequest/);
  assert.doesNotMatch(cliSrc, /maybeLearnFromReply/);
  assert.doesNotMatch(cliSrc, /listDiscussions/);
  assert.doesNotMatch(cliSrc, /from '\.\/services\/reviewer\.js'/);
  assert.doesNotMatch(cliSrc, /from '\.\/services\/learner\.js'/);
  assert.doesNotMatch(cliSrc, /from '\.\/services\/gitlab\.js'/);
});

test('commands.js exports the functions all entry points share', async () => {
  const mod = await import('../src/services/commands.js');
  for (const fn of [
    'runReview',
    'runLocalReview',
    'runStatus',
    'runLearn',
    'runSetupReview',
    'runRefreshReview',
  ]) {
    assert.equal(typeof mod[fn], 'function', `commands.js exports ${fn}`);
  }
});

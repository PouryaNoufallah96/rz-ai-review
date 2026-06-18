import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldAutomate,
  DEFAULT_IMPORTANT_BRANCHES,
} from '../src/services/reviewAutomation.js';

test('disabled automation is never allowed (opt-in default)', () => {
  assert.deepEqual(shouldAutomate({ automation: undefined, targetBranch: 'main' }), {
    allowed: false,
    reason: 'automation-disabled',
  });
  assert.deepEqual(
    shouldAutomate({ automation: { enabled: false, targetBranchPolicy: [] }, targetBranch: 'main' }),
    { allowed: false, reason: 'automation-disabled' },
  );
  // enabled must be strictly true.
  assert.equal(
    shouldAutomate({ automation: { enabled: 'yes' }, targetBranch: 'main' }).allowed,
    false,
  );
});

test('enabled + empty policy allows built-in important branches + defaultBranch only', () => {
  const automation = { enabled: true, targetBranchPolicy: [] };
  for (const branch of DEFAULT_IMPORTANT_BRANCHES) {
    assert.equal(shouldAutomate({ automation, targetBranch: branch }).allowed, true, branch);
  }
  // defaultBranch is added to the allowed set.
  assert.equal(
    shouldAutomate({ automation, targetBranch: 'release', defaultBranch: 'release' }).allowed,
    true,
  );
  // an unimportant branch is denied.
  const denied = shouldAutomate({ automation, targetBranch: 'feature/x' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'target-branch-not-important');
});

test('enabled + non-empty policy allows only listed branches', () => {
  const automation = { enabled: true, targetBranchPolicy: ['main', 'staging'] };
  assert.equal(shouldAutomate({ automation, targetBranch: 'main' }).allowed, true);
  assert.equal(shouldAutomate({ automation, targetBranch: 'staging' }).allowed, true);

  const denied = shouldAutomate({ automation, targetBranch: 'develop' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'target-branch-not-in-policy');

  // A non-empty policy overrides the built-in important set: even 'master' is
  // denied unless explicitly listed.
  assert.equal(shouldAutomate({ automation, targetBranch: 'master' }).allowed, false);
});

test('shouldAutomate tolerates missing args object', () => {
  assert.deepEqual(shouldAutomate(), { allowed: false, reason: 'automation-disabled' });
});

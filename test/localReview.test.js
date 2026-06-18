import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGitDiff } from '../src/services/localReview.js';

test('parseGitDiff returns GitLab-shaped file diffs for local review', () => {
  const files = parseGitDiff(`diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
 export const a = 1;
+export const b = 2;
diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`);

  assert.equal(files.length, 2);
  assert.deepEqual(files[0], {
    old_path: 'src/a.ts',
    new_path: 'src/a.ts',
    diff: files[0].diff,
    deleted_file: false,
    renamed_file: false,
    new_file: false,
    rename_only: false,
  });
  assert.equal(files[1].old_path, 'src/old.ts');
  assert.equal(files[1].new_path, 'src/new.ts');
  assert.equal(files[1].renamed_file, true);
  assert.equal(files[1].rename_only, true);
});

test('parseGitDiff returns empty for no local diff', () => {
  assert.deepEqual(parseGitDiff(''), []);
});

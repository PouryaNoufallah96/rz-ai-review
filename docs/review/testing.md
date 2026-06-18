# Testing Review Context

<!-- rz-review:generated:start -->
## Detected Test Setup

- Test script: `node --test "test/**/*.test.js"`
- Lint script: `eslint src --config src/eslint.config.js`
- Format script: `prettier --write "src/**/*.js"`

## Review Focus

- For behavior changes, expect focused tests or a clear reason tests are not practical.
- For CLI, webhook, and Git provider changes, check error paths and idempotency.
- For AI prompt/schema changes, check JSON shape compatibility and fallback behavior.
- For setup/refresh changes, check that human-owned documentation blocks are preserved.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Testing Notes

Preferred test seams for the planned improvements:

- Project Setup service: verify generated files, Review Config defaults, Instruction Pack selection, and preservation of human-owned markdown blocks.
- Review orchestration service: verify confidence filtering, redundant finding filtering, Review Verdict selection, and summary generation.
- CLI command layer: verify setup, refresh, review, status, and learn command routing at the highest practical seam.
- API command route: verify command parsing delegates to the same services as CLI.

Good tests should assert external behavior and generated artifacts, not private helper internals.
<!-- rz-review:human:end -->

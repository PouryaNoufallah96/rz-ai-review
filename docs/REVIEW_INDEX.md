# Review Index

<!-- rz-review:generated:start -->
## Purpose

This file maps the Project Knowledge used by the Review System. During review, load this file first, then load the most relevant referenced docs for the changed paths.

## Project Snapshot

- Project: rz-code-review
- Kinds: CLI, HTTP service, Static web UI, GitLab integration, AI-assisted workflow
- Main languages:
- JavaScript: 52 files
- Markdown: 21 files
- JSON: 3 files
- HTML: 1 files

## Context Docs

- docs/review/architecture.md
- docs/review/conventions.md
- docs/review/testing.md
- docs/review/security.md
- docs/review/workflows.md
- docs/review/domain.md
- docs/review/risk-map.md
- docs/review/backend.md
- docs/review/frontend.md

## Important Source Areas

- docs
- public
- src
- test

## Existing Documentation

- AGENTS.md
- CLAUDE.md
- CONTEXT.md
- README.md
- docs/REVIEW_GUIDE.example.md
- docs/REVIEW_GUIDE.md
- docs/REVIEW_INDEX.md
- docs/adr/0001-use-target-project-owned-review-knowledge.md
- docs/adr/0002-gate-inline-findings-by-confidence-and-explicit-verdict.md
- docs/adr/0003-separate-local-review-memory-from-target-project-checkpoints.md
- docs/adr/0004-make-review-quality-gate-the-default-posting-boundary.md
- docs/review/architecture.md
- docs/review/backend.md
- docs/review/conventions.md
- docs/review/domain.md
- docs/review/frontend.md
- docs/review/reviewer-behavior.md
- docs/review/risk-map.md
- docs/review/security.md
- docs/review/testing.md
- docs/review/workflows.md

## Important Files

- .env.example
- AGENTS.md
- CLAUDE.md
- README.md
- package.json

## Available Commands

- `start`: `node src/index.js`
- `dev`: `node --watch src/index.js`
- `review`: `node src/cli.js review`
- `review-local`: `node src/cli.js review-local`
- `learn`: `node src/cli.js learn`
- `status`: `node src/cli.js status`
- `setup-review`: `node src/cli.js setup-review`
- `refresh-review`: `node src/cli.js refresh-review`
- `lint`: `eslint src --config src/eslint.config.js`
- `test`: `node --test "test/**/*.test.js"`
- `format`: `prettier --write "src/**/*.js"`
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Notes

Load order for review:

1. Read the Review Config when present.
2. Read `docs/REVIEW_GUIDE.md`.
3. Read this Review Index.
4. Read `README.md` for teammate-facing setup and operating instructions.
5. Read the context docs that match changed paths and changed behavior.

Important review boundaries:

- CLI, API command, and webhook flows should stay behaviorally aligned.
- GitLab provider operations should remain separate from review orchestration.
- AI prompt/schema changes should preserve structured JSON output and strict posting gates.
- Project Setup and Project Refresh must preserve human-owned markdown blocks.
<!-- rz-review:human:end -->

# rz-code-review

AI-assisted GitLab merge request reviewer with a local review mode. It reads a target project's committed review guidance, reviews changed lines, posts only gated inline findings, and keeps local memory to reduce repeated noise.

## What It Provides

- Target-project setup: generates `.rz-review.json`, `docs/REVIEW_GUIDE.md`, `docs/REVIEW_INDEX.md`, and `docs/review/*.md`.
- Local diff review: reviews a local project without GitLab and prints JSON only.
- GitLab MR review: posts inline comments plus one summary note on a merge request.
- Re-review gate: refuses manual re-review until prior bot discussions are resolved.
- Learning workflow: turns useful developer replies into proposed `REVIEW_GUIDE.md` updates through a GitLab MR.
- Optional webhook server: accepts GitLab MR and note events.
- Review automation gate: webhook-triggered review is opt-in per target project.
- Review quality gate: filters low-confidence, non-actionable, duplicate, or known-noisy findings before posting.
- Local caches and memory: stores review runs, comment tracking, file review cache, learning cache, duplicate finding memory, and counters.

## Requirements

- Node.js `>=20`
- `pnpm install`
- OpenAI-compatible AI endpoint
- GitLab token for GitLab MR review, webhook review, status, and learning

`setup-review`, `refresh-review`, and some tests do not need GitLab credentials. Actual AI review needs `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`.

## Environment

Create `.env` from the example:

```bash
cp .env.example .env
pnpm install
```

Required for AI review:

```bash
AI_BASE_URL=https://ai.example.com/v1
AI_API_KEY=...
AI_MODEL=...
```

Required for GitLab commands and webhooks:

```bash
GITLAB_HOST=https://gitlab.com
GITLAB_TOKEN=glpat-...
GITLAB_BOT_USERNAME=review-bot
```

Optional:

```bash
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
GITLAB_WEBHOOK_SECRET=...
REVIEW_GUIDE_PATH=docs/REVIEW_GUIDE.md
MAX_DIFF_BYTES=200000
DB_PATH=./data/state.db
```

The JSON store is written to `DB_PATH` with `.db` replaced by `.json`, so the default persisted file is `./data/state.json`.

## Commands

```bash
pnpm run setup-review -- /path/to/project
pnpm run setup-review -- /path/to/project --local
pnpm run refresh-review -- /path/to/project
pnpm run refresh-review -- /path/to/project --local
pnpm run review-local -- /path/to/project [baseRef]
pnpm run review -- <projectId|namespace/path> <mrIid>
pnpm run status -- <projectId|namespace/path> <mrIid>
pnpm run learn -- <projectId|namespace/path> <mrIid>
pnpm run dev
pnpm run start
pnpm test
pnpm run lint
```

`baseRef` is passed to `git diff <baseRef>...HEAD`. If omitted, local review uses the unstaged/working-tree diff.

## Target Project Setup

For team projects, use shared setup and commit the generated review policy files:

```bash
pnpm run setup-review -- /Users/pourya/projects/personal/rz/coin-factory
```

Generated files:

```text
.rz-review.json
.rz-review/checkpoint.json
docs/REVIEW_GUIDE.md
docs/REVIEW_INDEX.md
docs/review/architecture.md
docs/review/conventions.md
docs/review/testing.md
docs/review/security.md
docs/review/workflows.md
docs/review/domain.md
docs/review/risk-map.md
docs/review/backend.md
docs/review/frontend.md
```

These files are intended to be committed for team use. They are shared review policy and project context, not private assistant configuration.

Use local-only setup only for scratch testing:

```bash
pnpm run setup-review -- /path/to/project --local
```

`--local` adds the generated review files to the target repo's `.git/info/exclude`, so they stay private to that clone.

Keep personal AI tooling excluded separately:

```text
/.agents/
/.claude/
/.codex/
/.cursor/
/.serena/
/.mcp.json
```

## Refreshing Project Knowledge

Run refresh after meaningful project structure changes:

```bash
pnpm run refresh-review -- /path/to/project
```

Refresh updates generated blocks while preserving human-owned markdown outside generated markers. Existing human edits in generated docs should be added outside the generated block.

`.rz-review/checkpoint.json` is metadata-only. It stores file hashes, classifications, affected contexts, and generated-doc fingerprints. It does not store source content, secrets, AI findings, comments, or token data.

## Review Config

`.rz-review.json` controls target-project review behavior:

```json
{
  "strictness": "high",
  "paths": {
    "guide": "docs/REVIEW_GUIDE.md",
    "index": "docs/REVIEW_INDEX.md",
    "contextDir": "docs/review"
  },
  "instructionPacks": ["backend", "baseline", "frontend"],
  "confidence": {
    "inline": "high",
    "summarize": "medium",
    "drop": "low"
  },
  "automation": {
    "enabled": false,
    "targetBranchPolicy": []
  },
  "features": {
    "deepIndex": false,
    "commandProbe": false,
    "fixBranch": false,
    "applyFixes": false,
    "externalBenchmark": false
  }
}
```

Setup and refresh merge missing defaults without clobbering existing human values. `features` are documented future flags unless code explicitly wires them.

## Local Review

Use local review before opening an MR or while testing this tool:

```bash
pnpm run review-local -- /path/to/project origin/main
```

Local review:

- Requires target project review docs.
- Reads local Git diff.
- Sends reviewable diffs to the AI.
- Applies the same quality gate as GitLab review.
- Prints JSON to the terminal.
- Does not post comments.
- Does not write findings into the target project.

Example important fields:

```json
{
  "verdict": "approved",
  "reviewableFiles": 13,
  "findings": [],
  "summarized": [],
  "dropped": 3,
  "skippedFiles": [{ "path": "pnpm-lock.yaml", "reason": "lockfile" }]
}
```

## GitLab MR Review

Run:

```bash
pnpm run review -- group/project 42
```

or:

```bash
pnpm run review -- 12345 42
```

MR review:

1. Loads target-project knowledge from the MR target branch.
2. Skips if the review guide is missing.
3. Fetches MR diffs.
4. Filters noisy files.
5. Sends uncached reviewable diffs to the AI.
6. Applies quality gate, duplicate memory, and per-MR deduplication.
7. Posts inline comments for accepted findings.
8. Posts one summary note with verdict, file counts, routing counts, and token usage.
9. Stores run metadata and discussion IDs locally.

If the same MR head SHA was already reviewed, it returns `skipped: "already-reviewed"`.

## Inline Comment Rules

A finding becomes a GitLab inline code comment only when all of these are true:

- The file is reviewable.
- The finding targets a commentable changed line.
- It is not known noise, such as a public Sentry/client DSN without a real credential.
- It passes the quality gate.
- It is not redundant in the same review run.
- It is not a duplicate of a previously posted unchanged finding.
- GitLab accepts the inline position.

Default strictness is `high`, so inline findings require:

- `confidence: "high"`
- valid severity: `blocker`, `major`, `minor`, or `nit`
- concrete `failureMode`
- concrete changed-code `evidence`
- concrete `fixDirection`

Medium-confidence findings are summarized in the general note. Low-confidence findings are dropped by default.

Sentry/client DSNs are not treated as secrets by themselves. Sentry findings still post if the changed code includes a private auth token, source-map upload token, write/admin token, API key, password, secret, or credential.

## Verdicts

Review output can include:

- `approved`: no high-confidence inline issues remain.
- `issues-found`: one or more inline findings were posted or returned.
- `needs-human-review`: unresolved medium-confidence concerns with thin project knowledge.
- `skipped`: no guide, no diff, already reviewed, or no reviewable files.

## Re-Review Gate

Manual `review` refuses re-review when prior bot-opened discussions for that MR are still unresolved. It exits with code `2`.

Use:

```bash
pnpm run status -- group/project 42
```

After all bot discussions are resolved, rerun:

```bash
pnpm run review -- group/project 42
```

The new review runs against the latest MR head SHA.

## Learning From Replies

Run:

```bash
pnpm run learn -- group/project 42
```

The learner scans human replies on bot-opened discussions. If a reply teaches a durable project-specific rule, it opens a guide-update MR that appends to `docs/REVIEW_GUIDE.md`.

The guide is never edited silently. Trivial replies such as `fixed`, `thanks`, or `done` are ignored before making an AI call.

Learning memory prevents the same lesson from being proposed repeatedly for the same evidence.

## Webhook Mode

Start the server:

```bash
pnpm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

GitLab webhook:

```text
POST /webhooks/gitlab
```

GitLab settings:

| Field | Value |
| --- | --- |
| URL | `https://<host>/webhooks/gitlab` |
| Secret token | `GITLAB_WEBHOOK_SECRET` |
| Triggers | Merge request events, Comments |

Webhook processing responds `202` immediately and processes review/learning asynchronously.

## Webhook Automation

Webhook-triggered review is off by default. Enable it in the target project's `.rz-review.json`:

```json
{
  "automation": {
    "enabled": true,
    "targetBranchPolicy": ["main", "develop"]
  }
}
```

If `targetBranchPolicy` is empty, automation allows `main`, `master`, `develop`, and the target project's default branch. Manual CLI/API review is not automation-gated.

Webhook review runs on MR open, reopen, and code update events. Note events can trigger learning and re-review checks.

## Command API

The server also exposes:

```text
GET /api/stats
POST /api/command
```

`POST /api/command` accepts text commands:

```text
/review <project> <mrIid>
/review-local <path> [base]
/status <project> <mrIid>
/learn <project> <mrIid>
/setup-review <path> [--local]
/refresh-review <path> [--local]
/help
```

`/api/stats` returns AI usage counters and review-quality routing counters. It does not include source code or finding bodies.

## File Filtering

The reviewer skips files with low review value:

- deleted files
- rename-only diffs
- empty diffs
- lockfiles
- generated/build output paths
- minified files
- source maps
- binary/assets
- diffs over 600 lines per file
- files over the total prompt budget after smaller files are included

Skipped files are reported in local JSON output or the MR summary note.

## Local Store

The local store tracks:

- guide cache
- reviewed MR head SHAs
- bot discussion IDs
- file review cache
- learner decision cache
- finding memory
- learning memory
- per-MR posted comment hashes
- usage counters
- review-quality counters

The store is local to the reviewer machine/server. It is not written into target projects.

## Team Workflow

Recommended first setup for each target project:

1. Run shared setup:

```bash
pnpm run setup-review -- /path/to/project
```

2. Review the generated docs.
3. Add project-specific rules outside generated blocks.
4. Commit the generated review setup to the target project.
5. Run a local review against a real branch:

```bash
pnpm run review-local -- /path/to/project origin/main
```

6. Tune `docs/REVIEW_GUIDE.md` if review noise appears.
7. Use GitLab MR review:

```bash
pnpm run review -- group/project 42
```

## Troubleshooting

`skipped: "no-guide"`:

The target branch does not contain the configured review guide. Run `setup-review`, commit the generated docs, and review again.

`already-reviewed`:

The same MR head SHA was already reviewed. Push a new commit or clear local state intentionally.

Exit code `2` on `review`:

Prior bot discussions are unresolved. Run `status`, resolve the discussions, then rerun review.

No inline comments but `summarized` is non-zero:

The findings did not meet the inline quality gate. They are medium-confidence or missing required fields.

Sentry DSN findings disappear:

Public telemetry/client DSNs are filtered unless paired with a real private credential.

Webhook does nothing:

Check `GITLAB_WEBHOOK_SECRET`, GitLab trigger type, target project `.rz-review.json` automation settings, and target branch policy.

Local review shows only JSON:

That is expected. `review-local` never posts or stores findings in the target project.

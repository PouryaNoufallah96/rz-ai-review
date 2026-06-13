# rz-code-review

GitLab Merge Request reviewer bot. Powered by Liara AI (OpenAI-compatible).

Supports **two modes**:

- **Manual / CLI** *(default for GitLab Free)* — you run `npm run review -- <project> <mr>` from the terminal.
- **Automatic / Webhook** *(optional)* — a Fastify server listens on `/webhooks/gitlab` and reviews MRs as they open/update.

When invoked, the bot:

1. Checks for `docs/REVIEW_GUIDE.md` in the project's target branch. If missing → no-op.
2. Loads (and caches) the guide per project + blob SHA.
3. Fetches the MR diff and asks the AI to produce inline + summary review comments.
4. Posts inline comments on changed lines (falls back to general notes if a position is invalid) and tracks each bot-opened discussion in a local JSON store.
5. On developer replies to bot discussions, optionally extracts a durable lesson and opens a follow-up MR that **appends** to `REVIEW_GUIDE.md`.
6. When **all bot-opened discussions on an MR are resolved**, re-reviews the MR against the latest commit.

## Architecture

```
src/
  index.js               # webhook server entrypoint (optional)
  cli.js                 # CLI entrypoint — review / learn / status
  config.js              # env validation (zod)
  server.js              # fastify app (webhook mode)
  routes/
    health.js
    webhook.js           # /webhooks/gitlab — disabled if no secret set
  domain/
    events.js            # MR / Note routing, re-review trigger (webhook mode)
  services/
    ai.js                # OpenAI SDK pointed at Liara base URL
    gitlab.js            # @gitbeaker/rest wrapper + inline-position helpers
    guide.js             # REVIEW_GUIDE.md fetch + cache
    reviewer.js          # orchestrates: guide + diff -> AI -> inline comments
    learner.js           # reply -> guide patch MR
  lib/
    diff.js              # unified-diff parser, commentable-line set
    logger.js            # pino
  db/
    index.js             # pure-JS JSON store (data/state.json)
docs/
  REVIEW_GUIDE.example.md
```

No native dependencies. State persists to `./data/state.json`.

## Setup

```bash
cp .env.example .env
# fill in GITLAB_TOKEN, AI_API_KEY, GITLAB_BOT_USERNAME
pnpm install   # or: npm install
```

Minimum required env vars (CLI mode):

```bash
GITLAB_HOST=https://gitlab.com
GITLAB_TOKEN=glpat-...
GITLAB_BOT_USERNAME=your-username
AI_BASE_URL=https://ai.liara.ir/api/<project>/v1
AI_API_KEY=...
AI_MODEL=google/gemini-2.0-flash-001
```

`GITLAB_WEBHOOK_SECRET` is only required if you want to run the webhook server.

## Manual mode (recommended for GitLab Free)

```bash
# Review an MR — or re-review if all bot comments are resolved
npm run review -- <namespace/path | projectId> <mrIid>

# Show which bot comments are open vs resolved
npm run status -- <namespace/path | projectId> <mrIid>

# Scan replies on bot discussions and propose guide updates
npm run learn  -- <namespace/path | projectId> <mrIid>
```

Examples:

```bash
npm run review -- coinbank1/frontend/app 1
npm run status -- 12345 42
npm run learn  -- coinbank1/frontend/app 1
```

Typical loop:

1. Developer opens MR `!42`.
2. You run `npm run review -- group/repo 42` → AI posts inline + summary comments.
3. Developer replies / pushes fixes / resolves threads.
4. *(Optional)* `npm run learn -- group/repo 42` to harvest durable lessons into a guide-update MR.
5. Once all bot threads are resolved, run `npm run review -- group/repo 42` again — it detects the new HEAD and re-reviews. If any thread is unresolved it refuses with exit code 2.

## Webhook mode (optional)

```bash
# Add to .env:
GITLAB_WEBHOOK_SECRET=some-strong-random-string

npm run dev   # starts on PORT (default 3000)
```

In GitLab (per project or at group level): **Settings → Webhooks → Add new webhook**

| Field | Value |
|---|---|
| URL | `https://<your-host>/webhooks/gitlab` |
| Secret token | same as `GITLAB_WEBHOOK_SECRET` |
| Triggers | **Merge request events**, **Comments** |

The bot user (token owner) must have **Reporter** access (or **Developer** if you want the learner to push guide-update MRs).

## How re-review gating works

The local JSON store tracks every inline discussion the bot opens. Before re-reviewing, the bot fetches all MR discussions, intersects with the tracked IDs, and checks each note's `resolved` flag. If **every** bot discussion is resolved, the reviewer runs again against the new HEAD SHA. Runs are de-duplicated by `(project_id, mr_iid, head_sha)` so the same commit is not reviewed twice.

## How the learner works

When a developer replies on a bot-opened discussion, the AI is asked one question: *does this reply teach a durable, project-specific rule worth adding to the guide?* If yes, the bot:

1. Branches off `default_branch` as `review-bot/guide-update-mr-<iid>-<ts>`.
2. Appends the proposed rule to `docs/REVIEW_GUIDE.md`.
3. Opens an MR back to `default_branch` for a human to approve.

The guide is **never** silently edited.

## Liara AI

OpenAI-compatible. The `openai` SDK is pointed at the Liara base URL via `AI_BASE_URL`. Default model: `google/gemini-2.0-flash-001`. The reviewer uses `response_format: { type: 'json_object' }` for structured output.

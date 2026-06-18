#!/usr/bin/env node
// Thin CLI entry point. It DELEGATES every command to the shared services in
// src/services/commands.js — the same functions the API command route and (for
// review) the webhook path use. The CLI owns only argument parsing, human
// readable console output, and process exit codes; it re-implements no review,
// status, learn, or setup logic (RZ-56 command alignment).
import {
  runLearn,
  runLocalReview,
  runRefreshReview,
  runReview,
  runSetupReview,
  runStatus,
} from './services/commands.js';

function usage() {
  console.log(`Usage:
  npm run review  -- <projectId|namespace/path> <mrIid>     Review or re-review an MR
  npm run review-local -- <path> [baseRef]                  Review a local diff without GitLab
  npm run learn   -- <projectId|namespace/path> <mrIid>     Scan replies and propose guide updates
  npm run status  -- <projectId|namespace/path> <mrIid>     Show bot discussions & resolution state
  npm run setup-review   -- <path> [--local]                Create shared review docs in a target project
  npm run refresh-review -- <path> [--local]                Refresh generated review docs

Examples:
  npm run review -- mygroup/myrepo 42
  npm run review -- 12345 42
  npm run setup-review -- /path/to/project
  npm run setup-review -- /path/to/project --local
  npm run review-local -- /path/to/project origin/main
`);
}

async function cmdReview(projectArg, mrIidArg) {
  const res = await runReview({ project: projectArg, mrIid: mrIidArg });
  if (!res.ok && res.kind === 'refused') {
    // Re-review refusal: bot discussions are still unresolved. Preserve the
    // historical non-zero exit so scripts/CI can detect the refusal.
    console.error(`Refusing to re-review: ${res.message}`);
    process.exit(2);
  }
  console.log(JSON.stringify(res.result ?? res, null, 2));
}

async function cmdLearn(projectArg, mrIidArg) {
  const res = await runLearn({ project: projectArg, mrIid: mrIidArg });
  if (!res.ok) {
    console.log(res.message);
    return;
  }
  for (const reply of res.replies) {
    const { author, ...rest } = reply;
    console.log(`reply by ${author}:`, rest);
  }
  console.log(`\nDone. Guide-update MRs opened: ${res.learned}`);
}

async function cmdStatus(projectArg, mrIidArg) {
  const res = await runStatus({ project: projectArg, mrIid: mrIidArg });
  if (res.total === 0) {
    console.log('No bot discussions tracked for this MR.');
    return;
  }
  console.log(`Bot discussions on MR !${mrIidArg}: ${res.total}`);
  for (const item of res.items) {
    console.log(
      `  [${item.resolved ? 'RESOLVED' : 'OPEN'}] ${item.file ?? '?'}:${item.line ?? '?'} — ${(item.preview ?? '').slice(0, 80)}`,
    );
  }
}

function isLocalOnlyFlag(flag) {
  return flag === '--local' || flag === '--private';
}

function rejectUnknownFlags(flags) {
  const unknown = flags.filter((flag) => !isLocalOnlyFlag(flag));
  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  }
}

function cmdSetupReview(targetPath, ...flags) {
  rejectUnknownFlags(flags);
  console.log(
    JSON.stringify(
      runSetupReview({ targetPath, localOnly: flags.some(isLocalOnlyFlag) }),
      null,
      2,
    ),
  );
}

function cmdRefreshReview(targetPath, ...flags) {
  rejectUnknownFlags(flags);
  console.log(
    JSON.stringify(
      runRefreshReview({ targetPath, localOnly: flags.some(isLocalOnlyFlag) }),
      null,
      2,
    ),
  );
}

async function cmdReviewLocal(targetPath, base) {
  const res = await runLocalReview({ targetPath, base });
  console.log(JSON.stringify(res, null, 2));
}

const [, , cmd, ...rawArgs] = process.argv;
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

if (!cmd) {
  usage();
  process.exit(1);
}

const commands = {
  review: { handler: cmdReview, arity: 2 },
  'review-local': { handler: cmdReviewLocal, arity: 1 },
  learn: { handler: cmdLearn, arity: 2 },
  status: { handler: cmdStatus, arity: 2 },
  'setup-review': { handler: cmdSetupReview, arity: 1 },
  'refresh-review': { handler: cmdRefreshReview, arity: 1 },
};
const handler = commands[cmd];
if (!handler) {
  usage();
  process.exit(1);
}
if (args.length < handler.arity) {
  usage();
  process.exit(1);
}

Promise.resolve(handler.handler(...args)).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});

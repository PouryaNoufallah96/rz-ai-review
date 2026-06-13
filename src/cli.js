#!/usr/bin/env node
import { store } from './db/index.js';
import { logger } from './lib/logger.js';
import { reviewMergeRequest } from './services/reviewer.js';
import { maybeLearnFromReply } from './services/learner.js';
import { listDiscussions } from './services/gitlab.js';

function usage() {
  console.log(`Usage:
  npm run review  -- <projectId|namespace/path> <mrIid>     Review or re-review an MR
  npm run learn   -- <projectId|namespace/path> <mrIid>     Scan replies and propose guide updates
  npm run status  -- <projectId|namespace/path> <mrIid>     Show bot discussions & resolution state

Examples:
  npm run review -- mygroup/myrepo 42
  npm run review -- 12345 42
`);
}

async function resolveProjectId(input) {
  if (/^\d+$/.test(input)) return Number(input);
  const { gitlab } = await import('./services/gitlab.js');
  const project = await gitlab.Projects.show(input);
  return project.id;
}

async function cmdReview(projectArg, mrIidArg) {
  const projectId = await resolveProjectId(projectArg);
  const mrIid = Number(mrIidArg);

  const tracked = store.listDiscussionsForMr({ projectId, mrIid });
  if (tracked.length > 0) {
    // Re-review path: only proceed if all bot discussions are resolved
    const trackedIds = new Set(tracked.map((r) => r.discussion_id));
    const discussions = await listDiscussions({ projectId, mrIid });
    const relevant = discussions.filter((d) => trackedIds.has(String(d.id)));
    const allResolved = relevant.every((d) =>
      (d.notes ?? []).every((n) => n.system || n.resolvable === false || n.resolved),
    );
    if (!allResolved) {
      console.error('Refusing to re-review: not all bot-opened discussions are resolved.');
      console.error('Resolve them on the MR, then run again.');
      process.exit(2);
    }
    console.log('All bot discussions resolved — running re-review against new HEAD.');
  }

  const result = await reviewMergeRequest({ projectId, mrIid, reason: 'manual' });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdLearn(projectArg, mrIidArg) {
  const projectId = await resolveProjectId(projectArg);
  const mrIid = Number(mrIidArg);

  const tracked = store.listDiscussionsForMr({ projectId, mrIid });
  if (tracked.length === 0) {
    console.log('No bot discussions on this MR. Run `review` first.');
    return;
  }
  const trackedIds = new Set(tracked.map((r) => r.discussion_id));
  const discussions = await listDiscussions({ projectId, mrIid });

  let proposed = 0;
  for (const d of discussions) {
    if (!trackedIds.has(String(d.id))) continue;
    const replies = (d.notes ?? []).filter((n) => !n.system).slice(1); // skip the bot's own first note
    for (const reply of replies) {
      const res = await maybeLearnFromReply({
        projectId,
        mrIid,
        discussionId: String(d.id),
        noteBody: reply.body,
        noteAuthor: reply.author?.username,
      });
      console.log(`reply by ${reply.author?.username}:`, res);
      if (res?.learned) proposed += 1;
    }
  }
  console.log(`\nDone. Guide-update MRs opened: ${proposed}`);
}

async function cmdStatus(projectArg, mrIidArg) {
  const projectId = await resolveProjectId(projectArg);
  const mrIid = Number(mrIidArg);

  const tracked = store.listDiscussionsForMr({ projectId, mrIid });
  if (tracked.length === 0) {
    console.log('No bot discussions tracked for this MR.');
    return;
  }
  const trackedIds = new Set(tracked.map((r) => r.discussion_id));
  const discussions = await listDiscussions({ projectId, mrIid });
  const relevant = discussions.filter((d) => trackedIds.has(String(d.id)));

  console.log(`Bot discussions on MR !${mrIid}: ${relevant.length}`);
  for (const d of relevant) {
    const firstNote = d.notes?.[0];
    const resolved = (d.notes ?? []).every(
      (n) => n.system || n.resolvable === false || n.resolved,
    );
    console.log(
      `  [${resolved ? 'RESOLVED' : 'OPEN'}] ${firstNote?.position?.new_path ?? '?'}:${firstNote?.position?.new_line ?? '?'} — ${(firstNote?.body ?? '').slice(0, 80)}`,
    );
  }
}

const [, , cmd, projectArg, mrIidArg] = process.argv;

if (!cmd || !projectArg || !mrIidArg) {
  usage();
  process.exit(1);
}

const commands = { review: cmdReview, learn: cmdLearn, status: cmdStatus };
const handler = commands[cmd];
if (!handler) {
  usage();
  process.exit(1);
}

handler(projectArg, mrIidArg).catch((err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'CLI failed');
  console.error(err?.message ?? err);
  process.exit(1);
});

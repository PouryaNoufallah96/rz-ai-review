import { store } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { chatJSON } from './ai.js';
import { gitlab } from './gitlab.js';
import { loadGuide } from './guide.js';
import { isTrivialReply } from '../lib/filters.js';
import { sha256 } from '../lib/hash.js';

// STABLE — keep as prefix for provider-side caching.
const LEARN_SYSTEM = `You evaluate developer replies on AI code review comments.
Decide if the reply contains a generalizable lesson that should be added to the
project's REVIEW_GUIDE.md so future reviews avoid the same mistake.

Output STRICT JSON:
{
  "shouldLearn": boolean,
  "reason": "short explanation",
  "guidePatch": "markdown block to APPEND to REVIEW_GUIDE.md (only if shouldLearn). Include a clear rule and example."
}

Be conservative. Only learn when the reply teaches a durable, project-specific
rule (not a one-off opinion, not a false-positive correction that's obvious).`;

function learnKey({ guideSha, body }) {
  return sha256('lrn1', guideSha, body);
}

export async function maybeLearnFromReply({
  projectId,
  mrIid,
  discussionId,
  noteBody,
  noteAuthor,
}) {
  const tracked = store.findDiscussion(discussionId);
  if (!tracked) return { skipped: 'not-bot-discussion' };

  if (isTrivialReply(noteBody)) {
    return { skipped: 'trivial-reply', learned: false };
  }

  const guide = await loadGuide({ projectId });
  if (!guide) return { skipped: 'no-guide' };

  // ---- Decision cache ----
  const key = learnKey({ guideSha: guide.sha, body: noteBody });
  const cached = store.getLearn(key);
  let decision;
  let usage = null;

  if (cached) {
    store.bumpStat('cache_hits_learn');
    decision = cached.decision;
    logger.info({ projectId, mrIid }, 'Learn cache hit');
  } else {
    const result = await chatJSON({
      system: LEARN_SYSTEM,
      user: `# Current REVIEW_GUIDE
${guide.content}

# Developer reply
author: ${noteAuthor}
file: ${tracked.file_path}:${tracked.new_line}
body:
${noteBody}`,
      maxTokens: 600,
    });
    usage = result.usage;
    decision = result.data;
    store.setLearn(key, decision);
  }

  if (!decision.shouldLearn || !decision.guidePatch) {
    return { learned: false, reason: decision.reason, fromCache: Boolean(cached), tokens: usage };
  }

  // ---- Open guide-update MR (idempotent enough — branches include MR + timestamp) ----
  const project = await gitlab.Projects.show(projectId);
  const defaultBranch = project.default_branch;
  const branchName = `review-bot/guide-update-mr-${mrIid}-${Date.now()}`;

  await gitlab.Branches.create(projectId, branchName, defaultBranch);

  const updated = `${guide.content.trimEnd()}\n\n${decision.guidePatch.trim()}\n`;
  await gitlab.RepositoryFiles.edit(
    projectId,
    config.REVIEW_GUIDE_PATH,
    branchName,
    updated,
    `docs(review-guide): incorporate feedback from !${mrIid}`,
  );

  const learnMr = await gitlab.MergeRequests.create(
    projectId,
    branchName,
    defaultBranch,
    `Update REVIEW_GUIDE from MR !${mrIid} feedback`,
    {
      description: `Auto-proposed by review bot based on a developer reply.\n\n**Reason:** ${decision.reason}\n\nReview and merge to incorporate into future reviews.`,
      removeSourceBranch: true,
    },
  );

  return { learned: true, mrIid: learnMr.iid, fromCache: Boolean(cached), tokens: usage };
}

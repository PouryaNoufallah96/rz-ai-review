import { store } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { listDiscussions } from '../services/gitlab.js';
import { reviewMergeRequest } from '../services/reviewer.js';
import { maybeLearnFromReply } from '../services/learner.js';

function isFromBot(user) {
  return user?.username === config.GITLAB_BOT_USERNAME;
}

export async function handleMergeRequestEvent(payload) {
  const action = payload.object_attributes?.action;
  const projectId = payload.project?.id;
  const mrIid = payload.object_attributes?.iid;
  if (!projectId || !mrIid) return { skipped: 'missing-ids' };

  if (isFromBot(payload.user)) return { skipped: 'bot-author' };

  if (['open', 'reopen', 'update'].includes(action)) {
    // Update fires often; only re-review on new push (oldrev present).
    if (action === 'update' && !payload.object_attributes?.oldrev) {
      return { skipped: 'non-code-update' };
    }
    return reviewMergeRequest({ projectId, mrIid, reason: action });
  }
  return { skipped: `unhandled-action:${action}` };
}

export async function handleNoteEvent(payload) {
  const projectId = payload.project?.id;
  const mrIid = payload.merge_request?.iid;
  const note = payload.object_attributes;
  if (!projectId || !mrIid || !note) return { skipped: 'missing-context' };
  if (isFromBot(payload.user)) return { skipped: 'bot-author' };
  if (note.noteable_type !== 'MergeRequest') return { skipped: 'not-mr-note' };
  if (!note.discussion_id) return { skipped: 'no-discussion' };

  return maybeLearnFromReply({
    projectId,
    mrIid,
    discussionId: String(note.discussion_id),
    noteBody: note.note,
    noteAuthor: payload.user?.username,
  });
}

/**
 * On MR update, GitLab fires events that include resolved discussions.
 * We check: are all bot-opened discussions on this MR now resolved?
 * If yes, trigger a re-review against the new HEAD.
 */
export async function maybeRereviewOnResolution(payload) {
  const projectId = payload.project?.id;
  const mrIid = payload.merge_request?.iid ?? payload.object_attributes?.iid;
  if (!projectId || !mrIid) return { skipped: 'missing-ids' };

  const tracked = store.listDiscussionsForMr({ projectId, mrIid });
  if (tracked.length === 0) return { skipped: 'no-bot-discussions' };

  const trackedIds = new Set(tracked.map((r) => r.discussion_id));
  const discussions = await listDiscussions({ projectId, mrIid });

  const relevant = discussions.filter((d) => trackedIds.has(String(d.id)));
  const allResolved = relevant.every((d) =>
    (d.notes ?? []).every((n) => n.system || n.resolvable === false || n.resolved),
  );

  if (!allResolved) {
    logger.info({ projectId, mrIid }, 'Not all bot discussions resolved; skipping re-review');
    return { skipped: 'unresolved' };
  }

  logger.info({ projectId, mrIid }, 'All bot discussions resolved; re-reviewing');
  return reviewMergeRequest({ projectId, mrIid, reason: 'resolved-all' });
}

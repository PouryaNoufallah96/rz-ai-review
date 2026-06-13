import { store } from '../db/index.js';
import { gitlab, listDiscussions } from './gitlab.js';
import { reviewMergeRequest } from './reviewer.js';
import { maybeLearnFromReply } from './learner.js';

async function resolveProjectId(input) {
  if (/^\d+$/.test(input)) return Number(input);
  const project = await gitlab.Projects.show(input);
  return project.id;
}

function isAllResolved(discussions, trackedIds) {
  const relevant = discussions.filter((d) => trackedIds.has(String(d.id)));
  return relevant.every((d) =>
    (d.notes ?? []).every((n) => n.system || n.resolvable === false || n.resolved),
  );
}

export async function runReview({ project, mrIid }) {
  const projectId = await resolveProjectId(project);
  const mrIidNum = Number(mrIid);
  const tracked = store.listDiscussionsForMr({ projectId, mrIid: mrIidNum });

  if (tracked.length > 0) {
    const trackedIds = new Set(tracked.map((r) => r.discussion_id));
    const discussions = await listDiscussions({ projectId, mrIid: mrIidNum });
    if (!isAllResolved(discussions, trackedIds)) {
      return {
        ok: false,
        kind: 'refused',
        message:
          'Not all bot-opened discussions are resolved. Resolve them on the MR, then try again.',
      };
    }
  }

  const result = await reviewMergeRequest({
    projectId,
    mrIid: mrIidNum,
    reason: 'manual',
  });
  return { ok: true, kind: 'review', result };
}

export async function runStatus({ project, mrIid }) {
  const projectId = await resolveProjectId(project);
  const mrIidNum = Number(mrIid);
  const tracked = store.listDiscussionsForMr({ projectId, mrIid: mrIidNum });
  if (tracked.length === 0) {
    return { ok: true, kind: 'status', total: 0, items: [] };
  }
  const trackedIds = new Set(tracked.map((r) => r.discussion_id));
  const discussions = await listDiscussions({ projectId, mrIid: mrIidNum });
  const relevant = discussions.filter((d) => trackedIds.has(String(d.id)));
  const items = relevant.map((d) => {
    const first = d.notes?.[0];
    const resolved = (d.notes ?? []).every(
      (n) => n.system || n.resolvable === false || n.resolved,
    );
    return {
      resolved,
      file: first?.position?.new_path ?? null,
      line: first?.position?.new_line ?? null,
      preview: (first?.body ?? '').slice(0, 200),
    };
  });
  return { ok: true, kind: 'status', total: items.length, items };
}

export async function runLearn({ project, mrIid }) {
  const projectId = await resolveProjectId(project);
  const mrIidNum = Number(mrIid);
  const tracked = store.listDiscussionsForMr({ projectId, mrIid: mrIidNum });
  if (tracked.length === 0) {
    return {
      ok: false,
      kind: 'no-discussions',
      message: 'No bot discussions on this MR. Run /review first.',
    };
  }
  const trackedIds = new Set(tracked.map((r) => r.discussion_id));
  const discussions = await listDiscussions({ projectId, mrIid: mrIidNum });
  const replies = [];
  for (const d of discussions) {
    if (!trackedIds.has(String(d.id))) continue;
    const notes = (d.notes ?? []).filter((n) => !n.system).slice(1);
    for (const reply of notes) {
      const res = await maybeLearnFromReply({
        projectId,
        mrIid: mrIidNum,
        discussionId: String(d.id),
        noteBody: reply.body,
        noteAuthor: reply.author?.username,
      });
      replies.push({ author: reply.author?.username, ...res });
    }
  }
  const learned = replies.filter((r) => r.learned).length;
  return { ok: true, kind: 'learn', learned, replies };
}

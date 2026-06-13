import { store } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { chatJSON } from './ai.js';
import {
  buildInlinePosition,
  createGeneralNote,
  getMergeRequest,
  getMergeRequestDiff,
  safeCreateInlineDiscussion,
} from './gitlab.js';
import { loadGuide } from './guide.js';
import { commentableLines } from '../lib/diff.js';
import { classifyFile } from '../lib/filters.js';
import { sha256 } from '../lib/hash.js';

// SYSTEM prompt is intentionally STABLE — it's the prefix providers can cache.
// Do not interpolate request-specific data into this string.
const SYSTEM_PROMPT = `You are a senior code reviewer for GitLab merge requests.

You will be given:
  (1) The project's REVIEW_GUIDE (rules the team agreed on).
  (2) One or more files with their unified diffs and the set of commentable
      new-file line numbers.

Return STRICT JSON of this shape:
{
  "comments": [
    {
      "file": "path/in/new/tree.js",
      "line": 42,
      "severity": "blocker|major|minor|nit",
      "body": "Short markdown comment citing the relevant guide rule when applicable."
    }
  ]
}

Rules:
- ONLY comment on real issues that violate the REVIEW_GUIDE or are objectively bugs.
- "line" MUST be one of the commentable new-file line numbers provided. Drop any comment whose target line isn't in that set.
- Be terse. No filler. Reference the guide rule when it applies (e.g., "R3").
- If nothing is wrong, return {"comments": []}.`;

function buildFileBlock(d, commentable) {
  const lines = [...commentable].slice(0, 500);
  return `## ${d.new_path}
Commentable new-file lines: ${JSON.stringify(lines)}
\`\`\`diff
${d.diff}
\`\`\``;
}

function fileCacheKey({ guideSha, file }) {
  return sha256('frv1', guideSha, file.new_path ?? '', file.diff ?? '');
}
function commentBodyKey({ file, line, body }) {
  return sha256('cb1', file, line, body);
}

export async function reviewMergeRequest({ projectId, mrIid, reason = 'opened' }) {
  const mr = await getMergeRequest({ projectId, mrIid });
  const headSha = mr.sha;

  if (store.findRun({ projectId, mrIid, headSha })) {
    logger.info({ projectId, mrIid, headSha }, 'Already reviewed this SHA');
    return { skipped: 'already-reviewed' };
  }

  const guide = await loadGuide({ projectId, ref: mr.target_branch });
  if (!guide) return { skipped: 'no-guide' };

  const rawDiffs = await getMergeRequestDiff({ projectId, mrIid });

  // ---------- Filter noise ----------
  const filtered = [];
  const skipped = [];
  for (const d of rawDiffs) {
    const verdict = classifyFile(d);
    if (verdict.skip) {
      skipped.push({ path: d.new_path ?? d.old_path, reason: verdict.reason });
      store.bumpStat('files_filtered');
    } else {
      filtered.push(d);
    }
  }

  if (filtered.length === 0) {
    logger.info({ projectId, mrIid, skipped: skipped.length }, 'No reviewable files');
    await createGeneralNote({
      projectId, mrIid,
      body: `🤖 **AI Review** — no reviewable files (skipped ${skipped.length} lockfile/binary/generated).`,
    });
    store.insertRun({ projectId, mrIid, headSha });
    return { posted: 0, total: 0, skippedFiles: skipped.length };
  }

  // ---------- Per-file cache lookup ----------
  const commentableMap = new Map();
  const cachedFiles = [];   // { file, comments }
  const uncachedFiles = []; // file objects to ask AI about

  for (const d of filtered) {
    const cs = commentableLines(d.diff);
    commentableMap.set(d.new_path, cs);
    const key = fileCacheKey({ guideSha: guide.sha, file: d });
    const hit = store.getFileReview(key);
    if (hit) {
      store.bumpStat('cache_hits_review');
      cachedFiles.push({ file: d, comments: hit.comments });
    } else {
      uncachedFiles.push({ file: d, key });
    }
  }

  logger.info(
    { projectId, mrIid, cached: cachedFiles.length, uncached: uncachedFiles.length, skipped: skipped.length },
    'File classification',
  );

  // ---------- Single AI call for uncached files only ----------
  let aiComments = [];
  let usage = null;

  if (uncachedFiles.length > 0) {
    // Bound the prompt size — if it exceeds budget, drop the largest files first.
    const budget = config.MAX_DIFF_BYTES;
    let total = 0;
    const included = [];
    for (const u of uncachedFiles) {
      const size = Buffer.byteLength(u.file.diff ?? '', 'utf8');
      if (total + size > budget && included.length > 0) {
        skipped.push({ path: u.file.new_path, reason: `over-budget(${size}B)` });
        continue;
      }
      total += size;
      included.push(u);
    }

    const userPrompt = `# REVIEW_GUIDE
${guide.content}

# FILES
${included.map((u) => buildFileBlock(u.file, commentableMap.get(u.file.new_path))).join('\n\n')}`;

    const result = await chatJSON({
      system: SYSTEM_PROMPT,
      user: userPrompt,
    });
    usage = result.usage;

    aiComments = Array.isArray(result.data?.comments) ? result.data.comments : [];

    // Cache by file: split AI comments back by file path.
    const byFile = new Map();
    for (const c of aiComments) {
      if (!c?.file) continue;
      if (!byFile.has(c.file)) byFile.set(c.file, []);
      byFile.get(c.file).push(c);
    }
    for (const u of included) {
      const list = byFile.get(u.file.new_path) ?? [];
      store.setFileReview(u.key, list);
    }
  }

  // ---------- Combine all comments (cached + fresh) ----------
  const allComments = [
    ...cachedFiles.flatMap((cf) => cf.comments),
    ...aiComments,
  ];

  // ---------- Header note ----------
  const stats = store.getStats();
  const header =
    `🤖 **AI Review** · reason \`${reason}\` · commit \`${headSha.slice(0, 8)}\`\n\n` +
    `Files: ${filtered.length} analyzed · ${cachedFiles.length} from cache · ${uncachedFiles.length} via AI` +
    (skipped.length ? ` · ${skipped.length} skipped (noise)` : '') +
    (usage?.total_tokens ? `\nTokens this run: \`${usage.total_tokens}\` (prompt ${usage.prompt_tokens ?? '?'} / completion ${usage.completion_tokens ?? '?'})` : '');
  await createGeneralNote({ projectId, mrIid, body: header });

  // ---------- Post inline comments with dedup ----------
  const diffRefs = mr.diff_refs;
  const run = store.insertRun({ projectId, mrIid, headSha });
  const runId = run.id;

  let posted = 0;
  let dedupSkipped = 0;
  for (const c of allComments) {
    const allowed = commentableMap.get(c.file);
    if (!allowed || !allowed.has(c.line)) {
      logger.warn({ file: c.file, line: c.line }, 'Dropping non-commentable line');
      continue;
    }
    const fileEntry = filtered.find((d) => d.new_path === c.file);
    if (!fileEntry) continue;

    const body = `**[${c.severity ?? 'note'}]** ${c.body}`;
    const bodyHash = commentBodyKey({ file: c.file, line: c.line, body });
    if (store.isPosted({ projectId, mrIid, bodyHash })) {
      dedupSkipped += 1;
      continue;
    }

    const position = buildInlinePosition({
      diffRefs,
      newPath: c.file,
      oldPath: fileEntry.old_path,
      newLine: c.line,
    });
    const created = await safeCreateInlineDiscussion({ projectId, mrIid, body, position });
    if (created?.id) {
      store.insertDiscussion({
        discussionId: String(created.id),
        projectId, mrIid, runId,
        filePath: c.file, newLine: c.line,
      });
      store.markPosted({ projectId, mrIid, bodyHash });
      posted += 1;
    }
  }

  logger.info(
    { projectId, mrIid, posted, total: allComments.length, dedupSkipped },
    'Review complete',
  );

  return {
    posted,
    total: allComments.length,
    cached: cachedFiles.length,
    aiCalls: uncachedFiles.length > 0 ? 1 : 0,
    skippedFiles: skipped.length,
    dedupSkipped,
    tokens: usage
      ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens }
      : null,
    stats: {
      lifetime_ai_calls: stats.ai_calls + (uncachedFiles.length > 0 ? 1 : 0),
      lifetime_cache_hits: stats.cache_hits_review + cachedFiles.length,
      lifetime_prompt_tokens: stats.prompt_tokens + (usage?.prompt_tokens ?? 0),
      lifetime_completion_tokens: stats.completion_tokens + (usage?.completion_tokens ?? 0),
    },
  };
}

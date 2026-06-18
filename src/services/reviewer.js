import { store } from "../db/index.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { chatJSON } from "./ai.js";
import {
  buildInlinePosition,
  createGeneralNote,
  getMergeRequest,
  getMergeRequestDiff,
  safeCreateInlineDiscussion,
} from "./gitlab.js";
import {
  loadProjectKnowledge,
  assembleKnowledgePrompt,
} from "./projectKnowledge.js";
import { selectVerdict } from "./reviewVerdict.js";
import { planFindings } from "./reviewPlan.js";
import { commentableLines } from "../lib/diff.js";
import { classifyFile } from "../lib/filters.js";
import { sha256 } from "../lib/hash.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewFileBlock } from "./reviewPrompt.js";

function fileCacheKey({ knowledgeSha, file }) {
  return sha256("frv1", knowledgeSha, file.new_path ?? "", file.diff ?? "");
}
function commentBodyKey({ file, line, body }) {
  return sha256("cb1", file, line, body);
}

export async function reviewMergeRequest({
  projectId,
  mrIid,
  reason = "opened",
}) {
  const mr = await getMergeRequest({ projectId, mrIid });
  const headSha = mr.sha;

  if (store.findRun({ projectId, mrIid, headSha })) {
    logger.info({ projectId, mrIid, headSha }, "Already reviewed this SHA");
    // No metrics: this SHA was already counted on its original run; counting it
    // again on every duplicate webhook fire would inflate the counters.
    return { skipped: "already-reviewed", verdict: "skipped" };
  }

  const knowledge = await loadProjectKnowledge({
    projectId,
    ref: mr.target_branch,
  });
  if (!knowledge.hasGuide) {
    store.recordReviewMetrics({ verdict: "skipped" });
    return { skipped: "no-guide", verdict: "skipped" };
  }

  const rawDiffs = await getMergeRequestDiff({ projectId, mrIid });

  // ---------- Filter noise ----------
  const filtered = [];
  const skipped = [];
  for (const d of rawDiffs) {
    const verdict = classifyFile(d);
    if (verdict.skip) {
      skipped.push({ path: d.new_path ?? d.old_path, reason: verdict.reason });
      store.bumpStat("files_filtered");
    } else {
      filtered.push(d);
    }
  }

  if (filtered.length === 0) {
    logger.info(
      { projectId, mrIid, skipped: skipped.length },
      "No reviewable files",
    );
    await createGeneralNote({
      projectId,
      mrIid,
      body: `🤖 **AI Review** — no reviewable files (skipped ${skipped.length} lockfile/binary/generated).`,
    });
    store.insertRun({ projectId, mrIid, headSha });
    store.recordReviewMetrics({ verdict: "skipped" });
    return {
      posted: 0,
      total: 0,
      skippedFiles: skipped.length,
      verdict: "skipped",
    };
  }

  // ---------- Per-file cache lookup ----------
  const commentableMap = new Map();
  const cachedFiles = []; // { file, comments }
  const uncachedFiles = []; // file objects to ask AI about

  for (const d of filtered) {
    const cs = commentableLines(d.diff);
    commentableMap.set(d.new_path, cs);
    const key = fileCacheKey({ knowledgeSha: knowledge.knowledgeSha, file: d });
    const hit = store.getFileReview(key);
    if (hit) {
      store.bumpStat("cache_hits_review");
      cachedFiles.push({ file: d, comments: hit.comments });
    } else {
      uncachedFiles.push({ file: d, key });
    }
  }

  logger.info(
    {
      projectId,
      mrIid,
      cached: cachedFiles.length,
      uncached: uncachedFiles.length,
      skipped: skipped.length,
    },
    "File classification",
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
      const size = Buffer.byteLength(u.file.diff ?? "", "utf8");
      if (total + size > budget && included.length > 0) {
        skipped.push({
          path: u.file.new_path,
          reason: `over-budget(${size}B)`,
        });
        continue;
      }
      total += size;
      included.push(u);
    }

    const userPrompt = `${assembleKnowledgePrompt(knowledge)}

# FILES
${included.map((u) => buildReviewFileBlock(u.file, commentableMap.get(u.file.new_path))).join("\n\n")}`;

    const result = await chatJSON({
      system: REVIEW_SYSTEM_PROMPT,
      user: userPrompt,
    });
    usage = result.usage;

    aiComments = Array.isArray(result.data?.comments)
      ? result.data.comments
      : [];

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

  // ---------- Plan findings: Quality Gate route + in-run redundancy ----------
  // Pure step (no GitLab/store): route each finding through the Review Quality
  // Gate by strictness, then collapse in-run redundant findings that share a
  // Finding Fingerprint to a single best instance.
  const diffByFile = new Map(filtered.map((d) => [d.new_path, d]));
  const plan = planFindings({
    comments: allComments,
    commentableMap,
    diffByFile,
    strictness: knowledge.strictness,
  });

  // ---------- Post inline comments through Review Memory + dedup ----------
  const diffRefs = mr.diff_refs;
  const run = store.insertRun({ projectId, mrIid, headSha });
  const runId = run.id;

  let posted = 0;
  let dedupSkipped = 0; // belt-and-suspenders per-MR body-hash dedup
  let duplicate = 0; // Review Memory cross-run Duplicate Findings skipped
  for (const item of plan.inline) {
    const c = item.finding;
    const fileEntry = diffByFile.get(c.file);
    if (!fileEntry) continue;

    // Cross-run Duplicate Finding: same Finding Fingerprint AND unchanged
    // affected code => already raised, skip (ADR 0004; CONTEXT.md "Duplicate
    // Finding"). Local-only Review Memory — never written to the Target Project.
    if (store.isDuplicateFinding({ fingerprint: item.fingerprint, codeHash: item.codeHash })) {
      duplicate += 1;
      continue;
    }

    const body = `**[${c.severity ?? "note"}]** ${c.body}`;
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
    const created = await safeCreateInlineDiscussion({
      projectId,
      mrIid,
      body,
      position,
    });
    if (created?.id) {
      store.insertDiscussion({
        discussionId: String(created.id),
        projectId,
        mrIid,
        runId,
        filePath: c.file,
        newLine: c.line,
      });
      store.markPosted({ projectId, mrIid, bodyHash });
      // Durable cross-run record so a re-review of the same MR (same code) skips
      // this finding next time. Local-only.
      store.recordFinding({
        fingerprint: item.fingerprint,
        codeHash: item.codeHash,
        projectId,
        mrIid,
        file: c.file,
        severity: c.severity,
        status: "posted",
      });
      posted += 1;
    }
  }

  const summarized = plan.summarize.length;
  const dropped = plan.drop.length;
  const redundant = plan.redundant; // in-run fingerprint collapses

  // ---------- Explicit Review Verdict ----------
  const { verdict } = selectVerdict({
    inlineCount: posted,
    summarizeCount: summarized,
    knowledge,
    reviewableFiles: filtered.length,
  });

  // ---------- Header note (states Verdict + summarized concerns) ----------
  const stats = store.getStats();
  const summaryBlock = plan.summarize.length
    ? `\n\nSummarized (medium-confidence) concerns — not posted inline:\n` +
      plan.summarize
        .slice(0, 10)
        .map(
          (s) =>
            `- \`${s.finding.file}:${s.finding.line ?? "?"}\` ${s.finding.failureMode || s.finding.body || "(concern)"}`,
        )
        .join("\n")
    : "";
  const header =
    `🤖 **AI Review** · verdict \`${verdict}\` · reason \`${reason}\` · commit \`${headSha.slice(0, 8)}\`\n\n` +
    `Files: ${filtered.length} analyzed · ${cachedFiles.length} from cache · ${uncachedFiles.length} via AI` +
    (skipped.length ? ` · ${skipped.length} skipped (noise)` : "") +
    `\nFindings: ${posted} posted · ${summarized} summarized · ${dropped} dropped` +
    (redundant ? ` · ${redundant} redundant` : "") +
    (duplicate ? ` · ${duplicate} duplicate` : "") +
    (usage?.total_tokens
      ? `\nTokens this run: \`${usage.total_tokens}\` (prompt ${usage.prompt_tokens ?? "?"} / completion ${usage.completion_tokens ?? "?"})`
      : "") +
    summaryBlock;
  await createGeneralNote({ projectId, mrIid, body: header });

  logger.info(
    {
      projectId,
      mrIid,
      verdict,
      posted,
      summarized,
      dropped,
      redundant,
      duplicate,
      total: allComments.length,
      dedupSkipped,
    },
    "Review complete",
  );

  // Review-quality metrics: counters only (verdict + routing totals), local.
  store.recordReviewMetrics({
    verdict,
    breakdown: { posted, summarized, dropped, redundant, duplicate },
  });

  return {
    verdict,
    posted,
    total: allComments.length,
    breakdown: { posted, summarized, dropped, redundant, duplicate },
    cached: cachedFiles.length,
    aiCalls: uncachedFiles.length > 0 ? 1 : 0,
    skippedFiles: skipped.length,
    dedupSkipped,
    tokens: usage
      ? {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        }
      : null,
    stats: {
      lifetime_ai_calls: stats.ai_calls + (uncachedFiles.length > 0 ? 1 : 0),
      lifetime_cache_hits: stats.cache_hits_review + cachedFiles.length,
      lifetime_prompt_tokens: stats.prompt_tokens + (usage?.prompt_tokens ?? 0),
      lifetime_completion_tokens:
        stats.completion_tokens + (usage?.completion_tokens ?? 0),
    },
  };
}

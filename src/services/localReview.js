import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256 } from "../lib/hash.js";
import { commentableLines } from "../lib/diff.js";
import { classifyFile } from "../lib/filters.js";
import {
  assembleKnowledgePrompt,
  loadProjectKnowledge,
} from "./projectKnowledge.js";
import { buildReviewFileBlock, REVIEW_SYSTEM_PROMPT } from "./reviewPrompt.js";
import { planFindings } from "./reviewPlan.js";
import { selectVerdict } from "./reviewVerdict.js";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
}

function diffArgs({ base }) {
  if (base) {
    return ["diff", "--no-ext-diff", "--find-renames", `${base}...HEAD`];
  }
  return ["diff", "--no-ext-diff", "--find-renames"];
}

function parseDiffHeader(header) {
  const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) return { oldPath: null, newPath: null };
  return { oldPath: match[1], newPath: match[2] };
}

export function parseGitDiff(diffText) {
  if (!diffText.trim()) return [];
  const chunks = diffText
    .split(/\n(?=diff --git )/)
    .filter((chunk) => chunk.startsWith("diff --git "));

  return chunks.map((chunk) => {
    const firstLine = chunk.split("\n", 1)[0];
    const { oldPath, newPath } = parseDiffHeader(firstLine);
    const deleted = /\n\+\+\+ \/dev\/null(?:\n|$)/.test(chunk);
    const renamed = /\nrename from .+\nrename to .+(?:\n|$)/.test(chunk);
    const renameOnly = renamed && !/\n@@ /.test(chunk);
    return {
      old_path: oldPath,
      new_path: deleted ? oldPath : newPath,
      diff: chunk,
      deleted_file: deleted,
      renamed_file: renamed,
      new_file: /\n--- \/dev\/null(?:\n|$)/.test(chunk),
      rename_only: renameOnly,
    };
  });
}

function getLocalDiffs({ targetPath, base }) {
  const root = path.resolve(targetPath);
  git(root, ["rev-parse", "--show-toplevel"]);
  return parseGitDiff(git(root, diffArgs({ base })));
}

function localFetchFile(root) {
  return async ({ filePath }) => {
    const fullPath = path.join(root, filePath);
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, "utf8");
    return { content, sha: sha256(content) };
  };
}

function compactFinding(item) {
  const f = item.finding;
  return {
    file: f.file,
    line: f.line,
    severity: f.severity,
    confidence: f.confidence,
    failureMode: f.failureMode,
    evidence: f.evidence,
    fixDirection: f.fixDirection,
    body: f.body,
    routeReasons: item.routeReasons,
  };
}

export async function reviewLocalProject({ targetPath, base = null }) {
  const [{ config }, { chatJSON }] = await Promise.all([
    import("../config.js"),
    import("./ai.js"),
  ]);
  const root = path.resolve(targetPath);
  const knowledge = await loadProjectKnowledge({
    projectId: "local",
    ref: "local",
    fetchFile: localFetchFile(root),
  });

  if (!knowledge.hasGuide) {
    return {
      ok: true,
      kind: "local-review",
      verdict: "skipped",
      skipped: "no-guide",
      targetPath: root,
    };
  }

  const rawDiffs = getLocalDiffs({ targetPath: root, base });
  const filtered = [];
  const skipped = [];

  for (const d of rawDiffs) {
    const verdict = classifyFile(d);
    if (verdict.skip) {
      skipped.push({ path: d.new_path ?? d.old_path, reason: verdict.reason });
    } else {
      filtered.push(d);
    }
  }

  if (filtered.length === 0) {
    return {
      ok: true,
      kind: "local-review",
      verdict: "skipped",
      skipped: rawDiffs.length === 0 ? "no-diff" : "no-reviewable-files",
      targetPath: root,
      base,
      skippedFiles: skipped,
    };
  }

  const commentableMap = new Map(
    filtered.map((d) => [d.new_path, commentableLines(d.diff)]),
  );

  const included = [];
  const overBudget = [];
  let totalBytes = 0;
  for (const file of filtered) {
    const size = Buffer.byteLength(file.diff ?? "", "utf8");
    if (totalBytes + size > config.MAX_DIFF_BYTES && included.length > 0) {
      overBudget.push({ path: file.new_path, reason: `over-budget(${size}B)` });
      continue;
    }
    totalBytes += size;
    included.push(file);
  }

  const userPrompt = `${assembleKnowledgePrompt(knowledge)}

# FILES
${included.map((file) => buildReviewFileBlock(file, commentableMap.get(file.new_path))).join("\n\n")}`;

  const result = await chatJSON({
    system: REVIEW_SYSTEM_PROMPT,
    user: userPrompt,
  });
  const comments = Array.isArray(result.data?.comments)
    ? result.data.comments
    : [];

  const diffByFile = new Map(included.map((d) => [d.new_path, d]));
  const plan = planFindings({
    comments,
    commentableMap,
    diffByFile,
    strictness: knowledge.strictness,
  });

  const { verdict, reasons } = selectVerdict({
    inlineCount: plan.inline.length,
    summarizeCount: plan.summarize.length,
    knowledge,
    reviewableFiles: included.length,
  });

  return {
    ok: true,
    kind: "local-review",
    targetPath: root,
    base,
    verdict,
    verdictReasons: reasons,
    reviewableFiles: included.length,
    skippedFiles: [...skipped, ...overBudget],
    findings: plan.inline.map(compactFinding),
    summarized: plan.summarize.map(compactFinding),
    dropped: plan.drop.length,
    redundant: plan.redundant,
    total: comments.length,
    tokens: result.usage
      ? {
          prompt: result.usage.prompt_tokens,
          completion: result.usage.completion_tokens,
          total: result.usage.total_tokens,
        }
      : null,
  };
}

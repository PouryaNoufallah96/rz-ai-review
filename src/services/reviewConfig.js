import fs from "node:fs";
import path from "node:path";

// Review Config: the Target Project owned, human-editable, committable file that
// controls Review Strictness, context paths, enabled Instruction Packs, confidence
// routing, and future feature flags (CONTEXT.md "Review Config"; ADR 0001/0002).
//
// Rules:
// - Created on setup if missing.
// - Never overwrites human-edited values. A non-destructive merge only adds
//   missing default keys, preserving everything a human set (deep merge for the
//   nested objects, but human-provided values always win).
// - automation defaults to disabled (Review Automation is opt-in, wired later).

export const REVIEW_CONFIG_FILE = ".rz-review.json";

export function defaultReviewConfig(scan) {
  return {
    version: 1,
    // Default high keeps normal PR review low-noise (PRD user story 11).
    strictness: "high",
    paths: {
      guide: "docs/REVIEW_GUIDE.md",
      index: "docs/REVIEW_INDEX.md",
      contextDir: "docs/review",
    },
    // Instruction Packs enabled for this project; inferred minimally from the
    // lightweight scan. Pack compilation itself is a later slice.
    instructionPacks: inferInstructionPacks(scan),
    // Confidence routing for the Review Quality Gate (ADR 0002/0004).
    confidence: {
      inline: "high",
      summarize: "medium",
      drop: "low",
    },
    // Opt-in only. Runtime wiring and Target Branch Policy come in a later slice.
    automation: {
      enabled: false,
      targetBranchPolicy: [],
    },
    // Future-workflow feature flags. Documentation/config ONLY: these are all
    // disabled and intentionally have no runtime behavior wired to them yet
    // (RZ-52). The non-destructive merge adds them to existing configs on
    // refresh. See docs/review/workflows.md "Future Workflows".
    features: {
      deepIndex: false,
      commandProbe: false,
      fixBranch: false,
      applyFixes: false,
      externalBenchmark: false,
    },
  };
}

// Selected Instruction Packs for a project, inferred minimally from the
// lightweight scan. Exported so pack compilation (src/defaults/instructionPacks)
// derives the same selection that lands in .rz-review.json — config and
// compilation always agree on which context docs exist.
export function inferInstructionPacks(scan) {
  const packs = ["baseline"];
  const kinds = scan?.projectKinds ?? [];
  const stack = scan?.stack ?? [];
  const isFrontend = stack.some(
    (s) =>
      s.includes("frontend") || s.includes("Static") || s.includes("assets"),
  );
  const isBackend = kinds.some(
    (k) =>
      k.includes("HTTP") ||
      k.includes("CLI") ||
      k.includes("GitLab") ||
      k.includes("Backend"),
  );
  if (isBackend) packs.push("backend");
  if (isFrontend) packs.push("frontend");
  return [...new Set(packs)].sort();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Adds only keys the human has not set. Existing values (including nested ones)
// are preserved exactly. Returns { merged, added } where added is the count of
// newly inserted keys, so callers can report created|updated|unchanged.
function mergeDefaults(existing, defaults) {
  let added = 0;
  const merged = isPlainObject(existing) ? { ...existing } : {};
  for (const [key, defValue] of Object.entries(defaults)) {
    if (!(key in merged)) {
      merged[key] = defValue;
      added += 1;
      continue;
    }
    if (isPlainObject(defValue) && isPlainObject(merged[key])) {
      const nested = mergeDefaults(merged[key], defValue);
      merged[key] = nested.merged;
      added += nested.added;
    }
  }
  return { merged, added };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeReviewConfig(root, scan) {
  const relPath = REVIEW_CONFIG_FILE;
  const filePath = path.join(root, relPath);
  const defaults = defaultReviewConfig(scan);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(defaults, null, 2)}\n`);
    return { path: relPath, status: "created" };
  }

  const existing = readJson(filePath);
  if (existing === null) {
    // Present but unparseable: treat like an unmanaged file and do not clobber.
    return { path: relPath, status: "skipped-existing-unmanaged" };
  }

  const { merged, added } = mergeDefaults(existing, defaults);
  if (added === 0) {
    return { path: relPath, status: "unchanged" };
  }
  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  return { path: relPath, status: "updated" };
}

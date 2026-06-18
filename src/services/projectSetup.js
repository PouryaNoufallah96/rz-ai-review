import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256 } from "../lib/hash.js";
import { writeReviewConfig } from "./reviewConfig.js";
import {
  compiledDocsForScan,
  withHeader,
  list,
  scriptList,
  languageList,
} from "../defaults/instructionPacks.js";
import {
  writeCheckpoint,
  readCheckpoint,
  diffCheckpoint,
  buildFilesMap,
} from "./projectCheckpoint.js";

const GENERATED_START = "<!-- rz-review:generated:start -->";
const GENERATED_END = "<!-- rz-review:generated:end -->";
const LOCAL_EXCLUDE_PATH = ".git/info/exclude";
const LOCAL_EXCLUDE_HEADER =
  "# --- Local rz-ai-review scratch setup (private to this clone; never committed) ---";
const LOCAL_EXCLUDE_PATTERNS = [
  "/.rz-review/",
  "/.rz-review.json",
  "/docs/REVIEW_GUIDE.md",
  "/docs/REVIEW_INDEX.md",
  "/docs/review/",
];

const IGNORED_DIRS = new Set([
  ".git",
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".out-of-scope",
  ".planning",
  ".playwright-mcp",
  ".rz-review",
  ".serena",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  "data",
]);

const IGNORED_REL_DIRS = new Set([
  "docs/agents",
  "docs/goals",
  "docs/handover",
  "docs/prd",
  "docs/resources",
  "docs/reviews",
  "plans",
]);

const EXT_LANGUAGE = new Map([
  [".js", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript React"],
  [".jsx", "JavaScript React"],
  [".css", "CSS"],
  [".html", "HTML"],
  [".json", "JSON"],
  [".md", "Markdown"],
  [".cs", "C#"],
  [".go", "Go"],
  [".py", "Python"],
  [".php", "PHP"],
  [".java", "Java"],
  [".kt", "Kotlin"],
  [".rs", "Rust"],
]);

function exists(filePath) {
  return fs.existsSync(filePath);
}

function ensureLocalReviewExclude(root) {
  const excludePath = path.join(root, LOCAL_EXCLUDE_PATH);
  if (!exists(path.join(root, ".git"))) {
    return { path: LOCAL_EXCLUDE_PATH, status: "skipped-not-git-repo" };
  }

  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = exists(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const missing = LOCAL_EXCLUDE_PATTERNS.filter(
    (pattern) => !lines.includes(pattern),
  );

  if (missing.length === 0) {
    return { path: LOCAL_EXCLUDE_PATH, status: "unchanged" };
  }

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const needsHeader = !existing.includes(LOCAL_EXCLUDE_HEADER);
  const block = [
    ...(needsHeader ? [LOCAL_EXCLUDE_HEADER] : []),
    ...missing,
  ].join("\n");
  fs.appendFileSync(
    excludePath,
    `${needsLeadingNewline ? "\n" : ""}${existing ? "\n" : ""}${block}\n`,
  );
  return { path: LOCAL_EXCLUDE_PATH, status: "updated" };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listFiles(root, { maxDepth = 4, maxFiles = 1200 } = {}) {
  const result = [];

  function walk(dir, depth) {
    if (result.length >= maxFiles || depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !IGNORED_REL_DIRS.has(relPath)) {
          walk(fullPath, depth + 1);
        }
        continue;
      }
      if (entry.isFile()) result.push(relPath);
    }
  }

  walk(root, 0);
  return filterGitIgnored(root, result).sort();
}

function filterGitIgnored(root, files) {
  if (files.length === 0 || !exists(path.join(root, ".git"))) return files;
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    return files;
  }
  try {
    const ignored = execFileSync(
      "git",
      ["-C", root, "check-ignore", "--stdin"],
      {
        input: `${files.join("\n")}\n`,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
    )
      .split(/\r?\n/)
      .filter(Boolean);
    const ignoredSet = new Set(ignored);
    return files.filter((file) => !ignoredSet.has(file));
  } catch (err) {
    if (err.status === 1) return files;
    return files;
  }
}

function packageManager(root) {
  if (exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(root, "yarn.lock"))) return "yarn";
  if (exists(path.join(root, "package-lock.json"))) return "npm";
  if (
    exists(path.join(root, "bun.lockb")) ||
    exists(path.join(root, "bun.lock"))
  )
    return "bun";
  return null;
}

function detectStack(root, pkg, files) {
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };
  const depNames = new Set(Object.keys(deps));
  const stack = [];

  if (depNames.has("fastify")) stack.push("Fastify HTTP server");
  if (depNames.has("@gitbeaker/rest"))
    stack.push("GitLab API integration via @gitbeaker/rest");
  if (depNames.has("openai")) stack.push("OpenAI-compatible AI provider");
  if (depNames.has("zod")) stack.push("Zod environment/config validation");
  if (depNames.has("pino")) stack.push("Pino structured logging");
  if (depNames.has("eslint")) stack.push("ESLint");
  if (depNames.has("prettier")) stack.push("Prettier");
  if (depNames.has("react") || depNames.has("next"))
    stack.push("React/Next frontend");
  if (depNames.has("vue") || depNames.has("nuxt"))
    stack.push("Vue/Nuxt frontend");
  if (depNames.has("vite")) stack.push("Vite frontend tooling");

  if (files.some((f) => f.startsWith("public/")))
    stack.push("Static public assets");
  if (files.some((f) => f.startsWith("src/routes/")))
    stack.push("Route modules");
  if (files.some((f) => /^src\/app\/.+\/route\.[cm]?[jt]s$/.test(f)))
    stack.push("Route modules");
  if (files.some((f) => f.startsWith("src/services/")))
    stack.push("Service modules");
  if (files.some((f) => f.startsWith("src/server/")))
    stack.push("Server modules");
  if (files.some((f) => /\.(sln|slnx|csproj)$/i.test(f)))
    stack.push(".NET backend");
  if (exists(path.join(root, ".gitlab-ci.yml"))) stack.push("GitLab CI");
  if (exists(path.join(root, "Dockerfile"))) stack.push("Docker");

  return [...new Set(stack)];
}

function detectLanguages(files) {
  const counts = new Map();
  for (const file of files) {
    const lang = EXT_LANGUAGE.get(path.extname(file).toLowerCase());
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language, count]) => ({ language, count }));
}

function detectProjectKind(pkg, files, stack) {
  const kinds = [];
  if (pkg?.bin || files.includes("src/cli.js")) kinds.push("CLI");
  if (
    stack.some((s) => s.includes("HTTP server")) ||
    stack.some((s) => s.includes("Route modules")) ||
    stack.some((s) => s.includes("Server modules"))
  ) {
    kinds.push("HTTP service");
  }
  if (stack.some((s) => s.includes(".NET backend"))) kinds.push("Backend service");
  if (files.some((f) => f.startsWith("public/"))) kinds.push("Static web UI");
  if (stack.some((s) => s.includes("GitLab"))) kinds.push("GitLab integration");
  if (stack.some((s) => s.includes("AI provider")))
    kinds.push("AI-assisted workflow");
  return kinds.length ? kinds : ["Application"];
}

function scanProject(targetRoot) {
  const root = path.resolve(targetRoot);
  const pkg = readJson(path.join(root, "package.json"));
  const files = listFiles(root);
  const stack = detectStack(root, pkg, files);
  const languages = detectLanguages(files);
  const scripts = pkg?.scripts ?? {};
  const docs = files.filter((f) => f.endsWith(".md")).slice(0, 50);

  return {
    root,
    files,
    name: pkg?.name ?? path.basename(root),
    packageManager: packageManager(root),
    projectKinds: detectProjectKind(pkg, files, stack),
    stack,
    languages,
    scripts,
    docs,
    importantFiles: files.filter((f) =>
      [
        "README.md",
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        ".env.example",
        ".gitlab-ci.yml",
        "Dockerfile",
      ].includes(f),
    ),
    sourceDirs: [
      ...new Set(
        files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]),
      ),
    ]
      .filter((d) => !IGNORED_DIRS.has(d))
      .sort(),
  };
}

function generatedBlock(content) {
  return `${GENERATED_START}\n${content.trim()}\n${GENERATED_END}`;
}

function replaceGeneratedBlock(existing, generated) {
  if (!existing) return generated;
  const start = existing.indexOf(GENERATED_START);
  const end = existing.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) return generated;
  const before = existing.slice(0, start);
  const after = existing.slice(end + GENERATED_END.length);
  return `${before}${generatedBlock(generated)}${after}`;
}

function hasGeneratedBlock(content) {
  return content.includes(GENERATED_START) && content.includes(GENERATED_END);
}

function extractGenerated(content) {
  const start = content.indexOf(GENERATED_START);
  const end = content.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) return content;
  return content.slice(start + GENERATED_START.length, end).trim();
}

function reviewGuide(scan) {
  return withHeader(
    "Review Guide",
    `## Project Facts

- Project: ${scan.name}
- Project kinds: ${scan.projectKinds.join(", ")}
- Package manager: ${scan.packageManager ?? "not detected"}

## Baseline Review Rules

### R1. Review behavior

Report only concrete issues that can affect correctness, security, maintainability, performance, accessibility, or user experience. Do not comment on style preferences unless this guide or the changed project conventions require it.

### R2. Severity

- blocker: must fix before merge because it can break production, expose data, corrupt state, or block core workflows.
- major: should fix before merge because it creates a real defect, regression risk, or hard-to-maintain design.
- minor: useful improvement with limited risk.
- nit: small cleanup; avoid posting unless it is clearly tied to project conventions.

### R3. Evidence

Every Review Finding must cite the changed code and explain the failure mode. Prefer one precise comment over several broad comments.

### R4. Project conventions

When this guide conflicts with discovered project conventions, prefer the explicit human-written sections in this file and the docs referenced by REVIEW_INDEX.md.

### R5. Generated and vendored code

Do not review generated, vendored, lockfile, build output, coverage output, or binary files unless the change directly modifies build/runtime behavior.

### R6. Security boundaries

Flag exposed secrets, unsafe shell execution, SQL/string injection, missing auth checks, unsafe webhook validation, and unvalidated external input at service boundaries.

### R7. Frontend quality

For frontend changes, check responsive behavior, accessibility basics, loading/error states, state consistency, and whether UI text or controls can overflow on narrow screens.

### R8. Backend quality

For backend changes, check input validation, error handling, idempotency, observability, transaction boundaries, API contract stability, and data consistency.`,
    `## Project-Specific Rules

Add human-owned review rules here. Keep each rule actionable and include examples when false positives are likely.`,
  );
}

function reviewIndex(scan, contextDocs) {
  return withHeader(
    "Review Index",
    `## Purpose

This file maps the Project Knowledge used by the Review System. During review, load this file first, then load the most relevant referenced docs for the changed paths.

## Project Snapshot

- Project: ${scan.name}
- Kinds: ${scan.projectKinds.join(", ")}
- Main languages:
${languageList(scan.languages)}

## Context Docs

${list(contextDocs)}

## Important Source Areas

${list(scan.sourceDirs)}

## Existing Documentation

${list(scan.docs)}

## Important Files

${list(scan.importantFiles)}

## Available Commands

${scriptList(scan.scripts)}`,
    `## Human Notes

Add navigation notes that the scanner cannot infer, such as domain boundaries, owner expectations, or files that reviewers should always read first.`,
  );
}

// Build the ordered list of docs this run compiles. Core docs (Review Guide and
// Review Index) are always written. Context docs come from the project's selected
// Instruction Packs, so e.g. backend.md/frontend.md only compile when their pack
// is selected. reviewIndex receives the compiled context-doc paths so its
// "Context Docs" list always matches what was actually written.
function compileDocPlan(scan) {
  const contextDocs = compiledDocsForScan(scan);
  const contextPaths = contextDocs.map((doc) => doc.relPath);
  return [
    { relPath: "docs/REVIEW_GUIDE.md", build: reviewGuide },
    {
      relPath: "docs/REVIEW_INDEX.md",
      build: (s) => reviewIndex(s, contextPaths),
    },
    ...contextDocs,
  ];
}

function isManagedDocPath(relPath) {
  return (
    relPath === "docs/REVIEW_GUIDE.md" ||
    relPath === "docs/REVIEW_INDEX.md" ||
    relPath.startsWith("docs/review/")
  );
}

function writeDoc(root, relPath, content) {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const existing = exists(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (existing && !hasGeneratedBlock(existing)) {
    return { path: relPath, status: "skipped-existing-unmanaged" };
  }

  const generated = extractGenerated(content);
  const next = existing ? replaceGeneratedBlock(existing, generated) : content;

  if (existing === next) return { path: relPath, status: "unchanged" };
  fs.writeFileSync(filePath, next);
  return { path: relPath, status: existing ? "updated" : "created" };
}

// Hash the generated block of a written doc as it sits on disk, so the
// checkpoint fingerprint matches exactly what is committed. Returns null when
// the file is missing or has no managed generated block (e.g. unmanaged docs).
function generatedDocFingerprint(root, relPath) {
  const filePath = path.join(root, relPath);
  if (!exists(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  if (!hasGeneratedBlock(content)) return null;
  return sha256(extractGenerated(content));
}

// Affected context doc ids for this project: the basename (without extension)
// of each managed docs/review/* doc that exists with a generated block.
function contextIdFor(relPath) {
  if (!relPath.startsWith("docs/review/")) return null;
  return path.basename(relPath, path.extname(relPath));
}

// List the trackable Target Project tree as the checkpoint sees it: re-listed
// from disk so freshly written docs/config are reflected, with the .rz-review/
// store excluded so the checkpoint never hashes itself.
function trackableTree(root) {
  return listFiles(root).filter(
    (rel) => !rel.split("/").includes(".rz-review"),
  );
}

export function setupProjectReview({ targetPath, mode = "setup", localOnly = false }) {
  const scan = scanProject(targetPath);
  const isRefresh = mode === "refresh";

  // In refresh mode, read the prior checkpoint and diff it against the current
  // tree BEFORE writing anything, so the incremental summary reflects what
  // changed since the last run rather than what this run just wrote.
  const priorCheckpoint = isRefresh ? readCheckpoint(scan.root) : null;
  const fileDiff = isRefresh
    ? diffCheckpoint(
        priorCheckpoint,
        buildFilesMap(scan.root, trackableTree(scan.root)),
      )
    : null;

  const files = [];

  if (localOnly) {
    const localExclude = ensureLocalReviewExclude(scan.root);
    if (localExclude.status !== "skipped-not-git-repo") {
      files.push(localExclude);
    }
  }

  // Core docs are always written; context docs come from the selected
  // Instruction Packs (selection drives compilation).
  const docPlan = compileDocPlan(scan);
  for (const { relPath, build } of docPlan) {
    files.push(writeDoc(scan.root, relPath, build(scan)));
  }

  // Review Config (.rz-review.json): created on setup, non-destructively merged
  // otherwise so human-edited values are never clobbered.
  files.push(writeReviewConfig(scan.root, scan));

  // Generated-doc fingerprints + affected contexts, derived from what is now on
  // disk so the checkpoint reflects the committed generated blocks. Only the
  // docs actually compiled this run are considered.
  const generatedDocFingerprints = {};
  const contexts = [];
  for (const { relPath } of docPlan) {
    const fingerprint = generatedDocFingerprint(scan.root, relPath);
    if (fingerprint === null) continue;
    generatedDocFingerprints[relPath] = fingerprint;
    const contextId = contextIdFor(relPath);
    if (contextId) contexts.push(contextId);
  }

  // Project Index Checkpoint (.rz-review/checkpoint.json): metadata-only and
  // deterministic. Re-list files so newly written docs/config are reflected;
  // exclude the .rz-review/ store itself to avoid hashing the checkpoint.
  files.push(
    writeCheckpoint(scan.root, {
      files: trackableTree(scan.root),
      contexts,
      generatedDocFingerprints,
    }),
  );

  const result = {
    ok: true,
    kind: isRefresh ? "refresh-review" : "setup-review",
    visibility: localOnly ? "local" : "shared",
    project: scan.name,
    root: scan.root,
    files,
    summary: {
      projectKinds: scan.projectKinds,
      packageManager: scan.packageManager,
      stack: scan.stack,
      languages: scan.languages,
    },
  };

  if (isRefresh) {
    // Generated docs are deterministic from the scan, so any 'created'/'updated'
    // doc status means a generated block was regenerated; 'unchanged' means the
    // checkpoint-aware refresh confirmed nothing to redo for that doc.
    const docResults = files.filter((f) => isManagedDocPath(f.path));
    result.refresh = {
      hadCheckpoint: priorCheckpoint !== null,
      changedFiles: fileDiff.changed,
      addedFiles: fileDiff.added,
      removedFiles: fileDiff.removed,
      unchangedCount: fileDiff.unchanged.length,
      regeneratedDocs: docResults
        .filter((f) => f.status === "created" || f.status === "updated")
        .map((f) => f.path),
      unchangedDocs: docResults
        .filter((f) => f.status === "unchanged")
        .map((f) => f.path),
    };
  }

  return result;
}

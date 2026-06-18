import { sha256 } from "../lib/hash.js";

// Project Knowledge loader.
//
// Loads the Target Project's committed Project Knowledge at review time: the
// Review Config (.rz-review.json), the Review Guide, the Review Index, and the
// compiled context docs under the project's context dir. The reviewer prefers
// these Target Project docs and never falls back to this repo's System Defaults
// at runtime — a missing doc is simply omitted (CONTEXT.md "Project Knowledge";
// ADR 0001/0002).
//
// Design notes:
// - The fetch seam is injectable (`fetchFile`) so the loader is testable with no
//   network/credentials. The default fetcher and the logger are resolved LAZILY
//   (dynamic import) so importing this module never pulls in env-validated config
//   — the loader/assembler can be unit-tested without GitLab/AI credentials.
// - Total knowledge size is bounded. The Review Guide and Review Index are the
//   highest-priority docs and are always retained; context docs are dropped
//   largest-first when the byte budget is exceeded, and every drop is logged so
//   truncation is never silent.
// - knowledgeSha is a stable sha256 over the assembled knowledge so the reviewer
//   can invalidate its per-file cache whenever ANY loaded doc changes.

export const REVIEW_CONFIG_FILE = ".rz-review.json";

// Lazily resolve the real logger. Importing it eagerly (or even lazily without
// guarding) pulls in the env-validated config module, which calls process.exit
// when credentials are absent — that would kill credential-free unit tests. So
// we only load the logger when the runtime env that config requires is present;
// otherwise we no-op. Drops are still observable via the returned contextDocs.
async function warn(meta, msg) {
  if (!process.env.GITLAB_HOST) return;
  try {
    const { logger } = await import("../lib/logger.js");
    logger.warn(meta, msg);
  } catch {
    // Logger unavailable in this environment: stay silent rather than crash.
  }
}

// Lazily resolve the real getFileContent for the runtime default. Same reason as
// `warn`: avoid eager config import at module load.
async function defaultFetchFile(args) {
  const { getFileContent } = await import("./gitlab.js");
  return getFileContent(args);
}

// The configured Review Guide path fallback. Read straight from the environment
// (the same source config.REVIEW_GUIDE_PATH derives from) so we don't import the
// env-validating config module — that keeps credential-free unit tests working
// while still honoring a REVIEW_GUIDE_PATH override at runtime.
function configuredGuidePath() {
  return process.env.REVIEW_GUIDE_PATH || DEFAULT_PATHS.guide;
}

// Byte budget for context docs only (Guide + Index are always kept on top of
// this). Generous enough for the full compiled doc set, but bounded so a runaway
// doc set cannot blow up the prompt.
export const CONTEXT_DOCS_BUDGET_BYTES = 80_000;

// The known compiled context-doc set, in priority order (highest first). When
// the budget forces drops we remove the largest doc among the lowest remaining
// priority tier, but priority here documents the intended ordering of the
// assembled prompt. Names are the docs/review/<name>.md basenames.
const CONTEXT_DOC_NAMES = [
  "architecture",
  "conventions",
  "testing",
  "security",
  "workflows",
  "domain",
  "risk-map",
  "backend",
  "frontend",
];

const DEFAULT_PATHS = {
  guide: "docs/REVIEW_GUIDE.md",
  index: "docs/REVIEW_INDEX.md",
  contextDir: "docs/review",
};

function byteLength(s) {
  return Buffer.byteLength(s ?? "", "utf8");
}

// Resolve the doc paths from the (possibly absent/partial) Review Config,
// falling back to defaults. `guidePathDefault` is config.REVIEW_GUIDE_PATH (or
// the hard default). Never throws on a malformed config.
function resolvePaths(reviewConfig, guidePathDefault) {
  const paths = reviewConfig?.paths ?? {};
  return {
    guide: paths.guide || guidePathDefault || DEFAULT_PATHS.guide,
    index: paths.index || DEFAULT_PATHS.index,
    contextDir: paths.contextDir || DEFAULT_PATHS.contextDir,
  };
}

function resolveStrictness(reviewConfig) {
  return reviewConfig?.strictness ?? "high";
}

// Drop context docs largest-first until the running total fits the budget.
// Returns { kept (input order preserved), dropped (names) }. Guide/Index are NOT
// part of this — they are always retained by the caller. The caller logs drops
// so truncation is never silent.
function applyContextBudget({ docs, budget }) {
  let total = docs.reduce((sum, d) => sum + byteLength(d.content), 0);
  if (total <= budget) return { kept: docs, dropped: [] };

  // Work on a copy ordered largest-first so we drop the biggest docs first.
  const dropOrder = [...docs].sort(
    (a, b) => byteLength(b.content) - byteLength(a.content),
  );
  const dropped = new Set();
  for (const d of dropOrder) {
    if (total <= budget) break;
    dropped.add(d.name);
    total -= byteLength(d.content);
  }

  return {
    kept: docs.filter((d) => !dropped.has(d.name)),
    dropped: [...dropped],
  };
}

/**
 * Lightweight loader for JUST the Target Project Review Config (.rz-review.json)
 * at a given ref. Used by the webhook Review Automation gate (src/domain/events.js)
 * so it can read `automation` without loading the full Project Knowledge prompt.
 *
 * Tolerant of absence and parse failure -> returns null (Automation then stays
 * opt-in/disabled by default). The `fetchFile` seam is injectable for tests.
 *
 * @returns {Promise<object|null>} parsed Review Config, or null.
 */
export async function loadReviewConfig({
  projectId,
  ref,
  fetchFile = defaultFetchFile,
}) {
  const raw = await fetchFile({ projectId, filePath: REVIEW_CONFIG_FILE, ref });
  if (!raw) return null;
  try {
    return JSON.parse(raw.content);
  } catch {
    await warn(
      { projectId },
      "Review Config present but unparseable; treating as absent",
    );
    return null;
  }
}

/**
 * Load the Target Project's Project Knowledge at a given ref.
 *
 * Returns:
 * {
 *   hasGuide, guide:{content,sha}|null, index:{content,sha}|null,
 *   config|null, strictness, contextDocs:[{name,content,sha}],
 *   hasKnowledge, knowledgeSha, paths
 * }
 *
 * Never falls back to System Defaults: missing docs are omitted. Missing Review
 * Guide => hasGuide:false so the reviewer can skip rather than speculate.
 */
export async function loadProjectKnowledge({
  projectId,
  ref,
  fetchFile = defaultFetchFile,
}) {
  // 1) Review Config (.rz-review.json). Tolerate absence and parse failure.
  let reviewConfig = null;
  const rawConfig = await fetchFile({
    projectId,
    filePath: REVIEW_CONFIG_FILE,
    ref,
  });
  if (rawConfig) {
    try {
      reviewConfig = JSON.parse(rawConfig.content);
    } catch {
      reviewConfig = null;
      await warn(
        { projectId },
        "Review Config present but unparseable; using safe defaults",
      );
    }
  }

  const paths = resolvePaths(reviewConfig, configuredGuidePath());
  const strictness = resolveStrictness(reviewConfig);

  // 2) Review Guide + Review Index.
  const [guideRemote, indexRemote] = await Promise.all([
    fetchFile({ projectId, filePath: paths.guide, ref }),
    fetchFile({ projectId, filePath: paths.index, ref }),
  ]);

  const guide = guideRemote
    ? { content: guideRemote.content, sha: guideRemote.sha }
    : null;
  const index = indexRemote
    ? { content: indexRemote.content, sha: indexRemote.sha }
    : null;

  // 3) Context docs: attempt the known compiled set; include those that exist.
  const contextResults = await Promise.all(
    CONTEXT_DOC_NAMES.map(async (name) => {
      const remote = await fetchFile({
        projectId,
        filePath: `${paths.contextDir}/${name}.md`,
        ref,
      });
      if (!remote) return null;
      return { name, content: remote.content, sha: remote.sha };
    }),
  );
  const existingContextDocs = contextResults.filter(Boolean);

  // 4) Bound total knowledge size — Guide/Index always retained; drop the
  //    largest context docs first when over budget. Log the drops so truncation
  //    is never silent.
  const { kept: contextDocs, dropped } = applyContextBudget({
    docs: existingContextDocs,
    budget: CONTEXT_DOCS_BUDGET_BYTES,
  });
  if (dropped.length > 0) {
    await warn(
      { projectId, dropped, budget: CONTEXT_DOCS_BUDGET_BYTES },
      "Project Knowledge over budget; dropped lowest-priority context docs",
    );
  }

  const hasGuide = guide !== null;
  const hasKnowledge = hasGuide || index !== null || contextDocs.length > 0;

  // 5) Stable fingerprint over the assembled knowledge for cache invalidation.
  //    Includes the resolved doc shas, context-doc contents, and the
  //    config-relevant bits (paths + strictness) so a config edit that changes
  //    which docs load also invalidates the cache.
  const knowledgeSha = sha256(
    "pk1",
    guide?.sha ?? "no-guide",
    index?.sha ?? "no-index",
    strictness,
    paths.guide,
    paths.index,
    paths.contextDir,
    ...contextDocs.flatMap((d) => [d.name, d.sha]),
  );

  return {
    hasGuide,
    guide,
    index,
    config: reviewConfig,
    strictness,
    contextDocs,
    hasKnowledge,
    knowledgeSha,
    paths,
  };
}

// Conservative instruction included when project context is absent or thin, so
// the reviewer reports only high-confidence, concrete issues rather than
// speculating from missing context.
const THIN_CONTEXT_INSTRUCTION =
  "Limited project context available — only report high-confidence, concrete issues; do not speculate.";

/**
 * PURE function: build the markdown Project Knowledge section for the AI user
 * prompt. Deterministic and bounded by the loader's budgeting. Sections are
 * clearly delimited: Review Guide, Review Index, then context docs. When context
 * docs are absent/thin, a conservative instruction line is appended.
 */
export function assembleKnowledgePrompt(knowledge) {
  const parts = [];

  if (knowledge?.guide?.content) {
    parts.push(`# REVIEW_GUIDE\n${knowledge.guide.content}`);
  }
  if (knowledge?.index?.content) {
    parts.push(`# REVIEW_INDEX\n${knowledge.index.content}`);
  }
  for (const doc of knowledge?.contextDocs ?? []) {
    parts.push(`# CONTEXT: ${doc.name}\n${doc.content}`);
  }

  // "Thin" = no context docs loaded (the Guide alone is not enough project
  // context to license speculative review).
  if (!(knowledge?.contextDocs?.length > 0)) {
    parts.push(THIN_CONTEXT_INSTRUCTION);
  }

  return parts.join("\n\n");
}

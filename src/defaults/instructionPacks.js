// Instruction Pack registry (System Defaults).
//
// An Instruction Pack is "a reusable set of review instructions owned by the
// Review System and compiled into editable Target Project markdown during
// Project Setup" (CONTEXT.md; ADR 0001). Packs are System Defaults, not hidden
// runtime skills: each pack declares the context doc(s) it compiles, and each
// doc is built from the lightweight scan into a generated/human block markdown
// file so Project Refresh can update the generated block while preserving human
// edits.
//
// Selection drives compilation. The packs compiled during setup/refresh are the
// project's selected Instruction Packs (the same set inferInstructionPacks(scan)
// produces and that lands in .rz-review.json `instructionPacks`), so a doc only
// compiles when its pack is selected.

import { inferInstructionPacks } from "../services/reviewConfig.js";

const GENERATED_START = "<!-- rz-review:generated:start -->";
const GENERATED_END = "<!-- rz-review:generated:end -->";
const HUMAN_START = "<!-- rz-review:human:start -->";
const HUMAN_END = "<!-- rz-review:human:end -->";

// --- Markdown helpers (shared with projectSetup) -------------------------------

export function list(items, fallback = "None detected.") {
  if (!items?.length) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join("\n");
}

export function scriptList(scripts) {
  const entries = Object.entries(scripts ?? {});
  if (!entries.length) return "- None detected.";
  return entries
    .map(([name, command]) => `- \`${name}\`: \`${command}\``)
    .join("\n");
}

export function languageList(languages) {
  if (!languages?.length) return "- None detected.";
  return languages.map((x) => `- ${x.language}: ${x.count} files`).join("\n");
}

export function generatedBlock(content) {
  return `${GENERATED_START}\n${content.trim()}\n${GENERATED_END}`;
}

export function humanBlock(content) {
  return `${HUMAN_START}\n${content.trim()}\n${HUMAN_END}`;
}

export function withHeader(title, generated, human) {
  return `# ${title}\n\n${generatedBlock(generated)}\n\n${humanBlock(human)}\n`;
}

// --- Context doc builders ------------------------------------------------------

function architecture(scan) {
  return withHeader(
    "Architecture Review Context",
    `## Detected Stack

${list(scan.stack)}

## Architecture Shape

- The project exposes ${scan.projectKinds.join(", ")} behavior.
- Source code is organized around these top-level areas:
${list(scan.sourceDirs)}

## Review Focus

- Check whether changes preserve the existing module boundaries.
- Check whether service, route, CLI, and storage changes keep responsibilities separated.
- Check whether new dependencies are justified by real complexity.
- Check whether generated Project Knowledge still matches changed architecture after large refactors.`,
    `## Human Architecture Notes

Document architectural boundaries, non-obvious tradeoffs, and areas where future Review Findings should be stricter or more forgiving.`,
  );
}

function conventions(scan) {
  return withHeader(
    "Convention Review Context",
    `## Detected Commands

${scriptList(scan.scripts)}

## Detected Conventions

- Prefer existing local services, route modules, domain modules, and library helpers before introducing new patterns.
- Keep environment handling centralized through the existing configuration module when one exists.
- Keep Git provider integration code isolated from review orchestration logic.
- Keep AI prompt construction stable where provider-side prefix caching can help.
- Prefer deterministic parsing and filtering before asking the model to reason.

## Review Focus

- Flag duplicated command logic between CLI, API, and webhook paths.
- Flag comments or prompts that create broad, noisy review behavior.
- Flag changes that make local and webhook modes diverge without a clear reason.`,
    `## Human Convention Notes

Add naming, formatting, layering, and workflow rules that should be treated as project-specific requirements.`,
  );
}

function testing(scan) {
  const hasTestScript = Boolean(scan.scripts.test);
  return withHeader(
    "Testing Review Context",
    `## Detected Test Setup

- Test script: ${hasTestScript ? `\`${scan.scripts.test}\`` : "not detected"}
- Lint script: ${scan.scripts.lint ? `\`${scan.scripts.lint}\`` : "not detected"}
- Format script: ${scan.scripts.format ? `\`${scan.scripts.format}\`` : "not detected"}

## Review Focus

- For behavior changes, expect focused tests or a clear reason tests are not practical.
- For CLI, webhook, and Git provider changes, check error paths and idempotency.
- For AI prompt/schema changes, check JSON shape compatibility and fallback behavior.
- For setup/refresh changes, check that human-owned documentation blocks are preserved.`,
    `## Human Testing Notes

Document project-specific quality gates, local validation commands, CI expectations, and accepted manual checks.`,
  );
}

function security() {
  return withHeader(
    "Security Review Context",
    `## Review Focus

- Secrets in code, logs, generated docs, fixtures, or examples; flag committed tokens, keys, and credentials.
- Unsafe shell or command execution: untrusted input reaching exec/spawn/eval or shell-interpolated strings.
- Injection at data boundaries: SQL/NoSQL, template, path traversal, and command injection from external input.
- Authentication and authorization: missing or weak auth checks on routes, CLI actions, and provider calls.
- Webhook validation: signature/token verification, replay protection, and idempotent event handling.
- External input boundaries: validate and bound input from routes, CLI args, Git provider, and AI provider responses before use.
- Provider/API errors: ensure failures do not leak sensitive data into logs or user-facing comments.
- Public telemetry/client DSNs are not credentials by themselves; only flag them when paired with private auth tokens, source-map upload tokens, write/admin tokens, or other credentials.

## Posting Threshold

Security findings still meet the normal evidence threshold. Do not post generic security advice without a concrete changed-code path and a described failure mode.`,
    `## Human Security Notes

Document the highest-risk security boundaries for this Target Project, trusted vs. untrusted input sources, and any accepted exceptions reviewers should not re-flag.`,
  );
}

function workflows() {
  return withHeader(
    "Workflow Review Context",
    `## Current Workflows

- Manual review: a user invokes the CLI with a Target Project and a merge request or local diff.
- Webhook review: GitLab merge request or note events trigger asynchronous review behavior.
- Learning: developer replies can produce proposed Review Guide updates through a follow-up merge request.
- Project Setup: Target Project docs and Review Config are generated from System Defaults and Discovered Project Context.
- Project Refresh: generated Project Knowledge sections are updated explicitly while human-owned sections are preserved.

## Future Workflows (documented, not enabled)

These workflows are documented for direction only. They are gated behind disabled
\`features\` flags in \`.rz-review.json\` and have no runtime behavior yet.

- Suggested Fixes (\`features.applyFixes\`): the Review System may propose patches without applying them automatically.
- Fix Branch (\`features.fixBranch\`): a future explicit command may create a Fix Branch or follow-up merge request to apply Suggested Fixes.
- Deep Index (\`features.deepIndex\`): a future heavier build may understand modules, workflows, domain rules, and risk areas beyond lightweight Project Setup.
- Command Probe (\`features.commandProbe\`): a future opt-in setup mode may inspect Target Project commands without becoming part of the default setup.
- External reviewer benchmarking (\`features.externalBenchmark\`): a future workflow may compare Review Findings against external reviewers to measure precision.
- Review Automation (\`automation.enabled\`): opt-in behavior that decides when merge request events trigger review without a manual command, bounded by Target Branch Policy.`,
    `## Human Workflow Notes

Default workflows should stay explainable and reversible. Anything that mutates a Target Project should be explicit, visible in Git, and avoid hidden background behavior.`,
  );
}

function domain() {
  return withHeader(
    "Domain Review Context",
    `## Confirmed Language

Use the project glossary (for example \`CONTEXT.md\`) when naming product concepts. Prefer the established terms over ad-hoc synonyms in Review Findings.

## Where to Document the Domain

- Bounded contexts and their boundaries: record which modules own which context and where they may not reach across.
- Domain language: keep a glossary of stable product terms; add a term once it is reused enough that reviewers should apply it consistently.
- Domain rules and invariants: document the rules that changed code must not violate so reviewers can flag regressions.

## Review Focus

- Flag changes that blur a bounded-context boundary or leak one context's concepts into another.
- Flag naming that diverges from the confirmed domain language without a documented reason.
- Flag changes that quietly weaken a documented domain invariant.`,
    `## Human Domain Notes

Document this Target Project's bounded contexts, domain language, and core invariants. Keep entries product-focused and implementation-neutral.`,
  );
}

function riskMap(scan) {
  return withHeader(
    "Risk Map",
    `## Highest-Risk Areas

- Changes to ${scan.projectKinds.join(", ")} entry points, because they affect core behavior.
- Setup and refresh code that writes files into Target Projects, because mistakes can overwrite human-owned Project Knowledge.
- External boundaries (routes, CLI, Git provider, AI provider, webhooks), because they handle untrusted input and side effects.
- Shared state and persistence, because they control deduplication, idempotency, and cross-run correctness.
- Output construction (review prompts, schemas, posted comments), because errors propagate to every Review Finding.

## Review Bias

- Be strict about anything that can increase redundant or low-confidence comments.
- Be strict about anything that can overwrite human-owned Project Knowledge or human-edited Review Config.
- Be strict about behavior drift between CLI, API command, and webhook paths.
- Be conservative about adding new runtime dependencies or hidden background behavior.`,
    `## Human Risk Notes

List the specific files, modules, or workflows reviewers should watch most closely in this Target Project, and why each one is high risk.`,
  );
}

function frontend(scan) {
  return withHeader(
    "Frontend Review Context",
    `## Detected Frontend Signals

${list(scan.stack.filter((s) => s.includes("frontend") || s.includes("Static") || s.includes("assets")))}

## Review Focus

- Check responsive layout for narrow and desktop viewports when UI files change.
- Flag fixed-width layouts, overflowing text, missing loading/error states, and inaccessible interactive controls.
- Prefer existing UI patterns and assets over adding unrelated visual systems.
- When no frontend framework is detected, treat public assets as static UI and keep changes simple.`,
    `## Human Frontend Notes

Document breakpoints, design system rules, accessibility expectations, and screens that require stricter review.`,
  );
}

function backend(scan) {
  return withHeader(
    "Backend Review Context",
    `## Detected Backend Signals

${list(scan.stack.filter((s) => !s.includes("frontend") && !s.includes("Static")))}

## Review Focus

- Check webhook validation, auth boundaries, external API failures, retries, idempotency, and duplicate processing.
- Check that local persistence remains safe for the intended deployment model.
- Check that AI and Git provider failures produce actionable user-facing errors.
- Check that API, CLI, and webhook paths share behavior instead of drifting.`,
    `## Human Backend Notes

Document service invariants, provider limits, deployment constraints, and data-retention expectations.`,
  );
}

// --- Pack registry -------------------------------------------------------------

// Each pack declares an id and the context doc(s) it compiles. `build(scan)`
// returns the full markdown (generated + human blocks via withHeader). Order is
// stable so compilation and the Review Index list stay deterministic.
export const INSTRUCTION_PACKS = [
  {
    id: "baseline",
    docs: [
      { relPath: "docs/review/architecture.md", build: architecture },
      { relPath: "docs/review/conventions.md", build: conventions },
      { relPath: "docs/review/testing.md", build: testing },
      { relPath: "docs/review/security.md", build: security },
      { relPath: "docs/review/workflows.md", build: workflows },
      { relPath: "docs/review/domain.md", build: domain },
      { relPath: "docs/review/risk-map.md", build: riskMap },
    ],
  },
  {
    id: "backend",
    docs: [{ relPath: "docs/review/backend.md", build: backend }],
  },
  {
    id: "frontend",
    docs: [{ relPath: "docs/review/frontend.md", build: frontend }],
  },
];

const PACK_BY_ID = new Map(INSTRUCTION_PACKS.map((pack) => [pack.id, pack]));

// The ordered context docs compiled for a given set of selected pack ids.
// Iterates the registry order (not the selection order) so output is stable
// regardless of how the selection is sorted; unknown pack ids are ignored.
export function compiledDocsForPacks(selectedPacks) {
  const selected = new Set(selectedPacks ?? []);
  const docs = [];
  for (const pack of INSTRUCTION_PACKS) {
    if (!selected.has(pack.id)) continue;
    docs.push(...pack.docs);
  }
  return docs;
}

// The ordered context docs compiled for a project: derive the selected packs
// from the scan via the shared inferInstructionPacks so Review Config and
// compilation always agree on which docs exist.
export function compiledDocsForScan(scan) {
  return compiledDocsForPacks(inferInstructionPacks(scan));
}

export function packExists(id) {
  return PACK_BY_ID.has(id);
}

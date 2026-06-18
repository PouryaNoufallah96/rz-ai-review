# Review Guide

<!-- rz-review:generated:start -->
## Project Facts

- Project: rz-code-review
- Project kinds: CLI, HTTP service, Static web UI, GitLab integration, AI-assisted workflow
- Package manager: pnpm

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

For backend changes, check input validation, error handling, idempotency, observability, transaction boundaries, API contract stability, and data consistency.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Project-Specific Rules

### P1. Silence is a valid outcome

The Review System should not post findings just because a review was requested. If no high-confidence issue exists, the correct Review Verdict is `approved` with a short summary.

### P2. Findings need failure modes

Every Review Finding must state what can break, where the evidence is, and what change would remove the risk. Broad advice, generic best practices, and possible improvements are not enough.

### P3. Confidence gates posting

Default Review Strictness is `high`. Post inline findings only when confidence is high. Medium-confidence concerns may appear in the summary. Drop low-confidence concerns.

### P4. Avoid redundant findings

A finding is redundant when it repeats an unresolved bot finding, repeats linter/typechecker output without explaining impact, shares the same root cause as another finding, or points to a broad guideline without concrete changed-code evidence.

### P5. Project Knowledge is authoritative

Review behavior should be driven by this Review Guide, the Review Index, and the referenced review context docs. Do not invent architecture expectations that are not present in Project Knowledge or directly evidenced by the changed code.

### P6. Fixes are explicit

Suggested Fixes may be included when they make the finding clearer, but the Review System must not mutate a Target Project unless a future explicit fix command is used.
<!-- rz-review:human:end -->

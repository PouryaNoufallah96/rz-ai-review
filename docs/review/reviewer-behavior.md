# Reviewer Behavior Context

<!-- rz-review:generated:start -->
## Purpose

This document defines how the Review System should behave when deciding whether to post Review Findings and Review Verdicts.

## Default Behavior

- Prefer no inline finding over a low-confidence or redundant finding.
- Treat `approved` as a successful Review Verdict when no high-confidence issues are found.
- Use medium-confidence concerns only in the summary unless Review Strictness explicitly allows more.
- Drop low-confidence concerns.
- Do not post findings that merely restate a guideline without changed-code evidence.

## Finding Contract

Each inline Review Finding must include:

- The concrete failure mode.
- The changed-code evidence.
- The expected fix direction.
- Honest severity.
- Confidence.

## Verdict Contract

Each review run should produce one explicit Review Verdict:

- `approved`: no high-confidence issues found.
- `issues-found`: high-confidence findings were posted.
- `needs-human-review`: the change is important but available Project Knowledge is not enough for a reliable automated judgment.
- `skipped`: review did not run because required Project Knowledge or changed-code context is missing.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Notes

The reviewer should be useful, not busy. It should avoid "maybe consider" comments during normal PR review. If a concern is speculative but still worth preserving, put it in the summary as a medium-confidence note rather than posting it inline.
<!-- rz-review:human:end -->

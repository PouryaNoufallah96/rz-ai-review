# AI Review System

This context defines the product language for a personal AI code review system that analyzes GitLab merge requests and local code changes using project-specific review knowledge.

## Language

**Review System**:
The product as a whole: CLI, GitLab integration, review engine, project knowledge, and learning workflow.
_Avoid_: bot, script, tool

**Project Knowledge**:
The repository-specific documentation and indexed context the Review System uses to understand architecture, conventions, and review rules.
_Avoid_: generic docs, prompt context, memory

**Target Project**:
The repository being configured and reviewed by the Review System.
_Avoid_: client repo, user repo, analyzed repo

**Project Setup**:
The first-time or repeatable process that scans a repository and creates the Project Knowledge files the Review System will use.
_Avoid_: onboarding, install, bootstrap

**System Defaults**:
The reusable templates, rules, and setup behavior owned by the Review System and applied when configuring a Target Project.
_Avoid_: global profile, shared docs, base config

**Baseline Review Docs**:
The default review guidance copied from System Defaults into a Target Project during Project Setup.
_Avoid_: starter docs, boilerplate rules

**Discovered Project Context**:
The project-specific architecture, stack, conventions, and domain signals inferred from the Target Project during Project Setup or refresh.
_Avoid_: dynamic docs, generated notes

**Project Refresh**:
An explicit command that updates generated parts of Project Knowledge after the Target Project changes.
_Avoid_: auto-sync, background regeneration

**Command Probe**:
A future opt-in setup mode that inspects Target Project commands without making it part of the default Project Setup.
_Avoid_: auto-test, command discovery, validation run

**Instruction Pack**:
A reusable set of review instructions owned by the Review System and compiled into editable Target Project markdown during Project Setup.
_Avoid_: skill, hidden prompt, rule bundle

**Deep Index**:
A future richer Project Knowledge build that uses heavier analysis to understand modules, workflows, domain rules, and risk areas beyond lightweight Project Setup.
_Avoid_: full scan, semantic map, heavy setup

**Review Index**:
The top-level map of Project Knowledge that points the Review System to the right context files for a given review.
_Avoid_: docs index, repo map, context map

**Review Guide**:
The human-readable, project-owned rules that define what the Review System should enforce during code review.
_Avoid_: policy file, prompt file

**Review Finding**:
A concrete issue reported by the Review System on a merge request or local diff.
_Avoid_: comment, suggestion, warning

**Review Verdict**:
The explicit outcome of a review run, such as approved, issues found, needs human review, or skipped.
_Avoid_: summary, status, result

**Suggested Fix**:
A patch or concrete remediation proposed for a Review Finding without changing code automatically.
_Avoid_: auto-fix, recommendation, hint

**Fix Branch**:
A branch created by the Review System only after an explicit user command to apply Suggested Fixes.
_Avoid_: automatic fix, bot commit

**Review Strictness**:
The configurable threshold that controls which findings are posted inline, summarized, or dropped.
_Avoid_: confidence setting, aggressiveness, sensitivity

**Review Quality Gate**:
The checks a Review Finding must pass before it is posted inline.
_Avoid_: quality metric, confidence filter, posting rule

**Review Config**:
The Target Project owned configuration file that controls Review Strictness, context paths, and feature flags for the Review System.
_Avoid_: runtime config, hidden settings, bot config

**Review Automation**:
The opt-in behavior that decides when GitLab merge request events should trigger review without a manual CLI command.
_Avoid_: auto trigger, webhook mode, background review

**Target Branch Policy**:
The Review Config rule that limits Review Automation to important merge request target branches.
_Avoid_: main-only rule, branch filter

**Review Memory**:
The persisted record of prior Review Findings, their code fingerprints, status, and whether the affected code changed enough to review again.
_Avoid_: comment history, duplicate cache, review cache

**Learning Memory**:
The persisted record of durable lessons already proposed from developer feedback, used to avoid repeated Review Guide update proposals.
_Avoid_: learn cache, feedback cache, reply cache

**Finding Fingerprint**:
A stable key for recognizing the same Review Finding across review runs, based on rule, failure mode, file, and the relevant changed code.
_Avoid_: body hash, comment hash, duplicate key

**Duplicate Finding**:
A Review Finding that matches prior Review Memory and whose affected code has not materially changed.
_Avoid_: repeated comment, redundant issue

**Project Index Checkpoint**:
The persisted scan state from Project Setup or Project Refresh that allows Project Knowledge to update incrementally.
_Avoid_: index cache, setup cache, scan state

**Checkpoint File**:
The Target Project owned file that stores non-sensitive Project Index Checkpoint metadata for incremental Project Refresh.
_Avoid_: cache file, memory file, generated state

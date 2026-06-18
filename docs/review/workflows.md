# Workflow Review Context

<!-- rz-review:generated:start -->
## Current Workflows

- Manual review: a user invokes the CLI with a Target Project and a merge request or local diff.
- Webhook review: GitLab merge request or note events trigger asynchronous review behavior.
- Learning: developer replies can produce proposed Review Guide updates through a follow-up merge request.
- Project Setup: Target Project docs and Review Config are generated from System Defaults and Discovered Project Context.
- Project Refresh: generated Project Knowledge sections are updated explicitly while human-owned sections are preserved.

## Future Workflows (documented, not enabled)

These workflows are documented for direction only. They are gated behind disabled
`features` flags in `.rz-review.json` and have no runtime behavior yet.

- Suggested Fixes (`features.applyFixes`): the Review System may propose patches without applying them automatically.
- Fix Branch (`features.fixBranch`): a future explicit command may create a Fix Branch or follow-up merge request to apply Suggested Fixes.
- Deep Index (`features.deepIndex`): a future heavier build may understand modules, workflows, domain rules, and risk areas beyond lightweight Project Setup.
- Command Probe (`features.commandProbe`): a future opt-in setup mode may inspect Target Project commands without becoming part of the default setup.
- External reviewer benchmarking (`features.externalBenchmark`): a future workflow may compare Review Findings against external reviewers to measure precision.
- Review Automation (`automation.enabled`): opt-in behavior that decides when merge request events trigger review without a manual command, bounded by Target Branch Policy.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Notes

Default workflows should stay explainable and reversible. Anything that mutates a Target Project should be explicit, visible in Git, and avoid hidden background behavior.
<!-- rz-review:human:end -->

# Backend Review Context

<!-- rz-review:generated:start -->
## Detected Backend Signals

- Fastify HTTP server
- GitLab API integration via @gitbeaker/rest
- OpenAI-compatible AI provider
- Zod environment/config validation
- Pino structured logging
- ESLint
- Prettier
- Route modules
- Service modules

## Review Focus

- Check webhook validation, auth boundaries, external API failures, retries, idempotency, and duplicate processing.
- Check that local persistence remains safe for the intended deployment model.
- Check that AI and Git provider failures produce actionable user-facing errors.
- Check that API, CLI, and webhook paths share behavior instead of drifting.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Backend Notes

Service invariants:

- CLI, API command, and webhook review paths should share the same review behavior.
- Review runs must remain deduplicated by project, merge request, and head commit.
- Re-review should remain gated by resolution of tracked bot discussions.
- Learner behavior should propose changes for human approval rather than silently editing Target Project guidance.
- Setup and refresh must preserve human-owned documentation blocks.

Deployment caveat:

- The current local JSON store is acceptable for personal usage, but any multi-instance or long-running hosted deployment needs a stronger state backend before being treated as reliable.
<!-- rz-review:human:end -->

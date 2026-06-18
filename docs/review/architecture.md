# Architecture Review Context

<!-- rz-review:generated:start -->
## Detected Stack

- Fastify HTTP server
- GitLab API integration via @gitbeaker/rest
- OpenAI-compatible AI provider
- Zod environment/config validation
- Pino structured logging
- ESLint
- Prettier
- Static public assets
- Route modules
- Service modules

## Architecture Shape

- The project exposes CLI, HTTP service, Static web UI, GitLab integration, AI-assisted workflow behavior.
- Source code is organized around these top-level areas:
- docs
- public
- src
- test

## Review Focus

- Check whether changes preserve the existing module boundaries.
- Check whether service, route, CLI, and storage changes keep responsibilities separated.
- Check whether new dependencies are justified by real complexity.
- Check whether generated Project Knowledge still matches changed architecture after large refactors.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Architecture Notes

Current boundaries:

- Review orchestration owns fetching Project Knowledge, building model input, filtering findings, and posting Review Verdicts.
- GitLab integration owns provider-specific project, merge request, file, discussion, and note operations.
- Project Setup owns Target Project scanning, Instruction Pack selection, Review Config creation, and generated markdown updates.
- Command surfaces should stay thin and delegate behavior to shared services.

Target architecture direction:

- Project Knowledge should be target-owned and versioned with the Target Project.
- System Defaults and Instruction Packs should live in this repository and compile into editable markdown during Project Setup.
- Deep Index, Command Probe, and Fix Branch behavior remain future workflows until the lighter setup and strict review behavior are reliable.
<!-- rz-review:human:end -->

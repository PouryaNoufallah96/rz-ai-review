# Convention Review Context

<!-- rz-review:generated:start -->
## Detected Commands

- `start`: `node src/index.js`
- `dev`: `node --watch src/index.js`
- `review`: `node src/cli.js review`
- `review-local`: `node src/cli.js review-local`
- `learn`: `node src/cli.js learn`
- `status`: `node src/cli.js status`
- `setup-review`: `node src/cli.js setup-review`
- `refresh-review`: `node src/cli.js refresh-review`
- `lint`: `eslint src --config src/eslint.config.js`
- `test`: `node --test "test/**/*.test.js"`
- `format`: `prettier --write "src/**/*.js"`

## Detected Conventions

- Prefer existing local services, route modules, domain modules, and library helpers before introducing new patterns.
- Keep environment handling centralized through the existing configuration module when one exists.
- Keep Git provider integration code isolated from review orchestration logic.
- Keep AI prompt construction stable where provider-side prefix caching can help.
- Prefer deterministic parsing and filtering before asking the model to reason.

## Review Focus

- Flag duplicated command logic between CLI, API, and webhook paths.
- Flag comments or prompts that create broad, noisy review behavior.
- Flag changes that make local and webhook modes diverge without a clear reason.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Convention Notes

Product language:

- Use Review System, Target Project, Project Knowledge, Project Setup, Project Refresh, Instruction Pack, Review Finding, Review Verdict, Review Strictness, and Review Config consistently.
- Avoid calling Instruction Packs "skills" in product docs; skills are agent-runtime behavior, while Instruction Packs are reusable review guidance.

Implementation conventions:

- Keep model prompts stable when possible to preserve provider-side prefix caching.
- Prefer deterministic filters before model reasoning.
- Prefer explicit config over hidden runtime behavior.
- Keep generated markdown sections marked and refreshable; keep human sections untouched.
- Do not add broad abstraction layers until CLI, API command, and webhook paths share a concrete need.
<!-- rz-review:human:end -->

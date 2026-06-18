# Domain Review Context

<!-- rz-review:generated:start -->
## Confirmed Language

Use the project glossary (for example `CONTEXT.md`) when naming product concepts. Prefer the established terms over ad-hoc synonyms in Review Findings.

## Where to Document the Domain

- Bounded contexts and their boundaries: record which modules own which context and where they may not reach across.
- Domain language: keep a glossary of stable product terms; add a term once it is reused enough that reviewers should apply it consistently.
- Domain rules and invariants: document the rules that changed code must not violate so reviewers can flag regressions.

## Review Focus

- Flag changes that blur a bounded-context boundary or leak one context's concepts into another.
- Flag naming that diverges from the confirmed domain language without a documented reason.
- Flag changes that quietly weaken a documented domain invariant.
<!-- rz-review:generated:end -->

<!-- rz-review:human:start -->
## Human Notes

Domain language should stay product-focused and implementation-neutral. Add new glossary terms to `CONTEXT.md` when a concept becomes stable enough that future reviewers should use it consistently.
<!-- rz-review:human:end -->

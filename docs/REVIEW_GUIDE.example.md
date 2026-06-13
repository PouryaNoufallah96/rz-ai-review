# Review Guide

This file lives in each GitLab project that wants AI review. Copy it to
`docs/REVIEW_GUIDE.md` and tailor the rules for the project. The bot reads this
file from the MR's **target branch** and caches it per project + blob SHA.

## Rules

### R1. No `console.log` in production code
Use the project logger (`src/lib/logger`). `console.*` is allowed only in scripts.

### R2. Never swallow errors
`catch` blocks must either rethrow, log with context, or convert to a domain error.

### R3. Public functions need input validation
Validate at boundaries (HTTP handlers, queue consumers). Trust internals.

### R4. SQL must use parameterized queries
String concatenation into SQL is a blocker.

## Severity legend

- **blocker** — must fix before merge
- **major** — should fix before merge
- **minor** — nice to fix
- **nit** — style/preference

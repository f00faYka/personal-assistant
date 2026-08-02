# Repository instructions for AI agents

Before starting work:

1. Read `docs/product-context.md`.
2. Read `docs/architecture.md`.
3. Read accepted decisions in `docs/decisions.md`.
4. Review `docs/open-questions.md`.
5. Review the relevant GitHub Issue and its dependencies.

## Working rules

- Prefer an approved, `ready` GitHub Issue over inventing unplanned work.
- Restate the issue scope before implementation and implement only that scope.
- Do not silently contradict accepted decisions. If implementation would change one, pause, explain the conflict, and obtain human review.
- If an issue explicitly requires product or architecture discussion, ask the human owner concrete questions and do not close it without owner review.
- Do not silently resolve anything listed in `docs/open-questions.md`; link or create a discovery issue.
- Keep product requirements separate from implementation choices.
- Prefer TDD when requirements are sufficiently defined. Always test authorization and private/shared-data boundaries when relevant.
- Prefer explicit schemas and runtime validation for AI output. Deterministic code must enforce authorization, ownership, destructive-action safeguards, scheduling, consistency, and business invariants.
- Preserve original user content separately from AI interpretations; AI output must never overwrite it silently.
- Update documentation when implementation changes documented behavior or an accepted decision.
- Store prompts and output schemas in version control when they are introduced.
- Use the smallest maintainable change; avoid dependencies and complexity without an approved need.
- Run the narrowest relevant checks first and report only checks actually run.
- Never commit secrets or private runtime data. Never commit, push, merge, or rewrite history unless the current task explicitly authorizes it.

Follow `docs/development-process.md` and `docs/github-workflow.md` for discovery, branches, commits, pull requests, review, and documentation updates.

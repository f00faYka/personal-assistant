# Development process

## Purpose

Humans and AI agents use the repository and GitHub Issues as durable context. Conversation history is never the sole record of requirements or decisions.

## Session startup

Before doing work:

1. Read `product-context.md`, `architecture.md`, accepted decisions in `decisions.md`, and `open-questions.md`.
2. Read the selected GitHub Issue, its parent epic, dependencies, linked discussions, and recent comments.
3. Confirm the issue is approved/`ready` and that dependencies are resolved.
4. Restate scope, acceptance criteria, exclusions, and any assumptions.
5. If a needed product or architecture choice is unresolved, stop treating it as an implementation detail and create or reference a discovery issue.

## Discovery workflow

Discovery is human-guided and handles one coherent decision area at a time.

1. Establish the concrete scenarios and constraints.
2. Ask focused, high-value questions rather than requesting broad preferences.
3. Explain what problem each alternative solves, with meaningful trade-offs.
4. Challenge assumptions where failure modes, privacy, cost, or operations warrant it.
5. Use experiments, benchmarks, or proofs of concept only when they answer a stated question; do not let them become production features accidentally.
6. Present a recommendation and explicitly list unresolved consequences.
7. Wait for owner review before calling the outcome accepted or closing the issue.
8. Update `product-context.md`, `architecture.md`, `decisions.md`, and `open-questions.md` as applicable.
9. Create focused follow-up issues for newly discovered work.

A discovery issue should result in clarified requirements, an accepted decision, a documented experiment/benchmark, a follow-up decision, or an explicit deferral.

## Implementation workflow

1. Select an approved `ready` implementation issue.
2. Create a focused branch using the conventions in `github-workflow.md`.
3. Prefer tests first when behavior is sufficiently defined.
4. Implement the smallest change that satisfies the approved acceptance criteria.
5. Run the narrowest relevant tests, type checks, lint, and security/privacy checks, expanding only as risk warrants.
6. Update documentation when behavior or an accepted decision changes.
7. Open a pull request linked to the issue, including decisions, trade-offs, validation, and unresolved concerns.
8. Obtain review; do not merge automatically unless explicitly instructed.

## Testing priorities

- authorization, separate identities, and private/shared isolation;
- visibility and ownership transitions;
- deterministic validation of AI outputs;
- idempotency and safe retries for background work;
- confirmation gates for destructive, shared, external, ambiguous, or low-confidence effects;
- original-content preservation and audit history;
- reminder/digest scheduling correctness;
- recovery and fallback behavior.

Tests and tools may be selected only after the relevant technology choices are accepted.

## Documentation responsibilities

- Product behavior changes: update `product-context.md`.
- Accepted or superseded decisions: update `decisions.md` with rationale and links.
- Architecture/topology changes: update `architecture.md`.
- Resolved or newly discovered uncertainties: update `open-questions.md`.
- Phase/delivery changes: update `roadmap.md`.
- Process changes: update this document or `github-workflow.md`.

Documentation changes should normally land in the same pull request as the behavior or decision they describe.

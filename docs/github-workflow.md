# GitHub workflow

## Backlog model

GitHub Issues are the primary backlog.

Every issue receives one permanent project work-item key in the form `PASS-####`, allocated sequentially and never reused or renumbered. The issue title must start with `PASS-####:`. The GitHub `#issue` number remains useful for links, while the `PASS-####` key connects issues, branches, pull requests, and commit history.

- **Epic:** a major product or technical workstream; contains a concise outcome and checklist/sub-issues.
- **Discovery:** one coherent unresolved decision area requiring owner review.
- **Implementation:** a concrete, approved deliverable with testable acceptance criteria.
- **Follow-up:** meaningful work discovered during implementation or review; never smuggled into unrelated scope.

Do not split work into tiny issues that provide no independent discussion, decision, or deliverable.

## Required issue content

Each issue should include:

- its `PASS-####` work-item key;
- context;
- goal;
- scope;
- non-goals where useful;
- open questions;
- expected output;
- acceptance criteria;
- dependencies;
- relevant documents;
- whether human input is required.

Use sub-issues, checklists, and `#issue` references to connect deliverables to epics and dependencies.

## Labels

| Label | Purpose |
| --- | --- |
| `epic` | Major workstream |
| `discovery` | Requirements, decision, evaluation, or experiment |
| `architecture` | System/design boundary |
| `product` | User behavior or scope |
| `backend` | Backend responsibility |
| `mobile` | Mobile client responsibility |
| `ai` | Transcription, model, routing, evaluation, or AI policy |
| `infrastructure` | Deployment and operations |
| `security` | Authentication, authorization, privacy, or secrets |
| `testing` | Verification and quality strategy |
| `documentation` | Durable context or developer guidance |
| `blocked` | Cannot progress until a named dependency changes |
| `needs-human-input` | Requires owner discussion/review |
| `ready` | Approved and dependencies resolved |
| `in-progress` | Actively being worked |

A discovery issue is not `ready` for closure merely because an agent wrote a recommendation. Owner review is part of its acceptance criteria.

## Selecting work

1. Prefer `ready` issues in roadmap order.
2. Confirm dependencies and accepted decisions.
3. Do not start a blocked issue or infer missing owner choices.
4. Assign the issue and replace `ready` with `in-progress` when work begins.
5. For discovery, keep `needs-human-input` until the owner reviews the outcome.

## Branches

Create branches from the current default branch:

- `docs/pass-0000-short-description`
- `discovery/pass-0000-short-description`
- `feature/pass-0000-short-description`
- `fix/pass-0000-short-description`

Use the issue's lower-case work-item key, lowercase kebab-case, and one issue per branch unless an explicitly approved issue spans related changes.

## Commits

Start every commit subject with its issue key, for example `PASS-0015: define minimum useful release`. Make focused, reviewable commits and use an imperative summary after the key. Reference the GitHub issue in the commit body when useful. Never include credentials, `.env` files, private audio, production data, or generated secrets.

The default branch is `main`. Changes normally reach it through a reviewed pull request using squash merge. The pull-request title and resulting squash-merge commit subject must start with the same `PASS-####` key as the issue. Confirm the final squash subject before merging.

## Pull requests

A pull request should:

- start its title with the linked issue's `PASS-####` key;
- link the issue with `Closes #N` only when merge should complete it;
- restate scope and non-goals;
- summarize significant design choices and trade-offs;
- list tests/checks actually run and their results;
- identify documentation changes;
- flag privacy, migration, operational, and unresolved concerns;
- remain focused enough to review safely.

Do not merge automatically unless the owner explicitly requests it. Discovery issues requiring human review remain open until the owner confirms the recorded outcome.

## When implementation exposes a decision

Pause that part of implementation. Search for an existing discovery issue; create one if needed, link it from the implementation issue/PR, and request owner input. Resume only after the issue is resolved or the implementation is safely narrowed to avoid it.

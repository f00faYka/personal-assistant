# Decisions

## How to use this document

This is the log of owner-reviewed product and architecture decisions. A discovery proposal, benchmark result, current direction, or AI recommendation is not accepted until the human owner reviews it. New entries should include date, status, context, decision, rationale, consequences, and links to the deciding issue or pull request.

Statuses: `accepted`, `superseded`, or `deprecated`. Unresolved matters belong in `open-questions.md`, not here.

## Accepted decisions from the initialization brief

### D-001 — Private two-user product

- **Status:** accepted
- **Decision:** Build for the owner and his wife, not as a public multi-tenant SaaS product.
- **Rationale:** This defines the actual users and favors operational simplicity and correctness over speculative scale.
- **Consequences:** Public tenant administration and organization features are out of initial scope; two separate user identities are still required.

### D-002 — Private-by-default user data

- **Status:** accepted
- **Decision:** Each user has a separate identity and private personal data. Private notes never become shared automatically.
- **Rationale:** Personal trust and isolation are core product requirements.
- **Consequences:** Sharing must be explicit and deterministic. Exact ownership and sharing semantics remain open.

### D-003 — Preserve original content and AI provenance

- **Status:** accepted
- **Decision:** Store original user content separately from transcription corrections and structured AI interpretations; never allow AI output to silently overwrite the original.
- **Rationale:** Users need fidelity, correction, and auditability when AI is uncertain or wrong.
- **Consequences:** The future domain and persistence model must represent provenance and action history explicitly.

### D-004 — Deterministic enforcement of critical invariants

- **Status:** accepted
- **Decision:** AI is not the sole enforcement mechanism for authorization, isolation, ownership, destructive actions, reminder scheduling, consistency, or important business rules.
- **Rationale:** Model output is probabilistic and cannot be the security or consistency boundary.
- **Consequences:** AI output requires schemas, validation, policy checks, and deterministic authorization before effects occur.

### D-005 — Backend-orchestrated AI with uploaded audio

- **Status:** accepted
- **Decision:** Mobile clients upload audio; the backend orchestrates transcription and other AI inference.
- **Rationale:** Central orchestration supports local inference on available hardware, provider substitution, consistent policy, and auditability.
- **Consequences:** Offline capture/synchronization behavior and the backend-to-AI deployment boundary still require discovery.

### D-006 — Human-reviewed discovery before technology selection

- **Status:** accepted
- **Decision:** Product ambiguities and major architecture/technology choices are resolved through focused discovery issues and owner review before implementation.
- **Rationale:** The project must not turn AI-generated assumptions into accidental commitments.
- **Consequences:** React Native, Ollama, Qwen, Whisper, local-first inference, and iOS-first delivery are current directions or candidates where noted, not blanket acceptance of a concrete setup.

## No accepted technology stack yet

No concrete backend, database, authentication, storage, queue, deployment, push, or mobile library stack is accepted as of initialization.

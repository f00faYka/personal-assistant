# Open questions

## Rules for resolution

Every item below is unresolved. Do not infer an answer from a candidate technology or from an AI-generated proposal. Resolve questions through a focused GitHub discovery issue, one decision area at a time, with explicit human review before closure. Record accepted outcomes in `decisions.md` and update affected documents.

## Product and release scope

- What concrete scenarios define the minimum useful first release?
- What is the first vertical slice, and which tempting capabilities are explicitly deferred?
- What behavior is required for hands-free use, especially during cycling, and which actions are safe in that context?
- What are the exact morning-digest contents, timing, ranking, quiet hours, shared-item behavior, and failure expectations?

## Identity, ownership, and sharing

- Which authentication method is appropriate for a private two-user system?
- Will both users always have separate accounts and devices? Are shared devices a supported scenario?
- What exact rules distinguish private and shared information?
- Can visibility change after creation, who may change it, and what confirmation is required?
- Does a shared item have one owner plus participants, joint ownership, or another model?
- Who can view, edit, complete, unshare, or delete a shared item?

## Domain behavior

- Are notes, tasks, reminders, shopping items, and calendar-event candidates separate entities, roles of one item, or linked concepts?
- How does new input add information to an existing item without losing provenance?
- Which candidate task fields and statuses are necessary initially, and what do their state transitions mean?
- What constitutes an event candidate versus a committed calendar event?

## Automation, confidence, and confirmation

- Which actions may execute automatically?
- Which actions always require confirmation?
- How are risk, missing information, ambiguity, and confidence combined into a deterministic policy?
- How should transcription confidence be measured and calibrated across the selected implementation and languages?
- How is hands-free confirmation performed safely when a screen cannot be reviewed?

## Mobile client

- Which iPhone/iOS versions and any other devices are initial targets?
- What concrete React Native setup and supporting libraries best fit the accepted backend and operational model?
- What must work offline, how long can captures remain local, and how are conflicts handled?
- What notification permissions, deep-link routes, background behavior, and audio-session behavior are required?

## Backend and job processing

- What are the backend's deployable boundaries and APIs?
- Which language and framework best meet the project's simplicity, correctness, AI-integration, and maintenance needs?
- Which work is synchronous versus asynchronous?
- Is a dedicated queue/worker needed initially, or is a simpler durable job mechanism sufficient?
- What retry, timeout, cancellation, idempotency, and failure-recovery behavior is required?

## Data, files, and retention

- Which database best fits the domain, isolation, auditability, deployment, and backup requirements?
- How are user isolation and ownership enforced at storage and application boundaries?
- Where are audio files stored, encrypted, backed up, and deleted?
- What AI/action audit history must be retained and exposed to users?
- What are the retention and deletion rules for audio, transcriptions, model outputs, tasks, and logs?

## Local and cloud AI

- Does Ollama meet the provider, structured-output, latency, operational, and observability needs, and what alternatives merit comparison?
- Which Qwen model sizes/quantizations perform adequately on the available M1 Pro for each intended task?
- Which local Whisper implementation provides acceptable accuracy, confidence signals, language support, latency, and maintainability?
- What stable provider interfaces and structured-output schemas are needed?
- When should the system escalate from deterministic handling to a local small model, larger local model, or cloud model?
- What privacy disclosures and consent are needed before any cloud fallback?
- Which evaluation set, metrics, traces, prompt/model versions, and reproducibility data are required?

## Deployment and operations

- Is the home Mac the complete server, an AI inference worker, or development-only?
- What happens when the Mac sleeps, loses connectivity, or is unavailable?
- What remote-access model is safe and maintainable?
- Which deployment model fits the chosen availability and AI topology?
- Which push-notification provider and credential model should be used?
- How are secrets stored, rotated, and recovered?
- What backup, restore-testing, update, rollback, monitoring, and disaster-recovery procedures are proportionate?

## Discovery-issue map

The initial GitHub backlog groups these questions into focused issues for product context, minimum release, ownership/sharing, automation policy, domain model, digest, devices/offline behavior, mobile architecture, backend, job processing, data/storage, local LLMs, Whisper/confidence, AI provider/evaluation, home-Mac deployment, push infrastructure, and operational recovery.

Before continuing implementation, initialize the project as an AI-assisted development workspace and create the documentation, repository structure and planning artifacts needed to preserve context across Codex sessions.

This prompt is intended to bootstrap the project and establish the development process. It is not intended to begin feature implementation or prematurely lock architectural and technology decisions.

Use the product context below as the initial source of truth.

Do not start implementing application features yet.

First:

1. Initialize and inspect the project repository.
2. Establish the documentation and AI-agent workspace.
3. Connect the local repository to GitHub.
4. Create the initial GitHub issue structure.
5. Identify unresolved product, architecture and technology decisions.
6. Create dedicated discovery issues for those decisions.
7. Show me the proposed repository structure, documentation and GitHub backlog for review.

Do not silently resolve decisions that are explicitly marked as unresolved.

# Project initialization

## Git and GitHub

Git should be initialized before creating project artifacts so that all subsequent changes are tracked.

Perform the following steps:

1. Check whether the current directory is already a Git repository.
2. If it is not, initialize Git.
3. Create an appropriate `.gitignore`.
4. Create the initial project structure and documentation.
5. Create clear, focused commits for the initialization work.
6. Use the existing GitHub MCP connection and available GitHub credentials to:

   * create or connect the GitHub repository;
   * configure the remote;
   * push the initial commits;
   * create the initial GitHub Issues backlog.

Do not expose, print or commit credentials, tokens or secrets.

Before creating a new GitHub repository, verify that an appropriate repository does not already exist.

## AI development workspace

Organize the repository so that AI agents can work consistently across sessions without depending on conversation history.

Create these files:

* `AGENTS.md` — concise repository-level instructions for AI agents;
* `docs/product-context.md` — product vision, users, use cases, functional requirements and non-goals;
* `docs/architecture.md` — current accepted architecture and technical boundaries;
* `docs/decisions.md` — accepted architectural and product decisions with rationale;
* `docs/roadmap.md` — project phases, milestones and delivery order;
* `docs/open-questions.md` — unresolved product, architecture and technology questions;
* `docs/development-process.md` — how humans and AI agents plan, implement, test and review work;
* `docs/github-workflow.md` — issue, branch, commit, pull request and review conventions.

Initially, `docs/architecture.md` and `docs/decisions.md` may contain placeholders and explicitly unresolved sections. Do not fill them with assumed decisions merely to make the documents appear complete.

`AGENTS.md` should tell future agents to:

1. Read `docs/product-context.md`.
2. Read `docs/architecture.md`.
3. Read accepted decisions in `docs/decisions.md`.
4. Review `docs/open-questions.md`.
5. Review the relevant GitHub Issue before starting work.
6. Avoid contradicting accepted decisions silently.
7. Update documentation when implementation changes an accepted decision or documented behavior.
8. Prefer working from an approved GitHub Issue rather than inventing unplanned work.
9. Ask the human for input when an issue explicitly requires product or architecture discussion.
10. Prefer TDD when requirements are sufficiently defined.

# Product context

The product is a private life-assistant application for me and my wife. It is not currently intended to be a public SaaS product.

The application should help us quickly capture thoughts, reminders, plans and tasks, primarily through voice notes.

Additional: Hands-free voice mode for situations such as cycling, allowing the user to capture notes, query tasks and perform low-risk actions through spoken dialogue and audio responses.

## Users

There are two users:

* me;
* my wife.

Each user must have a separate identity and private personal data.

Some items may later be shared between users, for example:

* household tasks;
* shopping;
* family plans;
* reminders concerning children;
* shared appointments.

Private notes must not become shared automatically.

## Main workflow

A user records a voice note in the mobile application.

The application:

1. Saves the original audio file.
2. Sends the audio for speech transcription.
3. Evaluates the transcription confidence and ambiguity.
4. If the transcription is unclear or ambiguous, shows it to the user and allows the user to confirm or edit it.
5. If the transcription is sufficiently clear, continues automatically without interrupting the user.
6. Sends the resulting text for AI classification and structuring.
7. Determines the intended action and evaluates its confidence and risk level.
8. Automatically performs low-risk, high-confidence actions, such as creating a simple note, task, reminder or shopping item.
9. Requests user confirmation only when:

   * the intended action is ambiguous;
   * AI confidence is below the configured threshold;
   * important information is missing;
   * the action changes or deletes existing data;
   * the action affects shared data;
   * the action has external or potentially consequential effects.
10. Stores the original audio, transcription, structured interpretation, confidence scores and performed action for later review.

The note may become:

* a task;
* a reminder;
* a backlog item;
* a general note;
* an idea;
* a shopping item;
* an event candidate;
* additional information for an existing item.

The original transcription and the structured AI interpretation must be stored separately.

AI output must never silently overwrite the original user content.

## Tasks

A task may contain:

* title;
* original note;
* description;
* owner;
* visibility: private or shared;
* status;
* priority;
* due date;
* reminder date;
* project or area;
* tags;
* blocking reason;
* creation source;
* AI confidence.

Initial task statuses:

* inbox;
* planned;
* in progress;
* blocked;
* waiting;
* review;
* completed;
* cancelled.

Avoid implementing unnecessary product complexity before real usage demonstrates a need.

## Daily digest

The application should generate a morning digest.

The digest should include relevant items such as:

* unfinished tasks;
* overdue tasks;
* blocked tasks;
* tasks waiting for another person or event;
* tasks requiring review;
* tasks requiring user confirmation;
* important tasks for today.

The digest should be generated by a backend scheduler and delivered using a push notification.

Opening the notification should navigate to a digest screen.

Digest contents must be user-specific.

Shared household tasks may appear for both users when appropriate.

The notification must be delivered to the mobile device even when the application is closed.

## AI responsibilities

AI may be used for:

* speech transcription;
* classification of notes;
* extraction of task fields;
* detecting dates and reminders from natural language;
* identifying whether an item is personal or potentially shared;
* suggesting links to existing tasks;
* generating daily digests;
* summarizing accumulated context.

AI must not be trusted as the only enforcement mechanism for:

* authorization;
* user isolation;
* data ownership;
* destructive actions;
* reminder scheduling;
* database consistency;
* important business invariants.

Those requirements must be enforced by deterministic application code.

## Local AI

During development and initial personal use, local AI inference should be preferred whenever it provides sufficient quality and performance.

Current direction:

* Ollama as the local LLM runtime;
* Qwen as the primary candidate model family for reasoning, classification and structured extraction;
* Whisper running locally on the backend for speech-to-text transcription;
* local inference on an Apple Silicon Mac, initially an M1 Pro;
* cloud model fallback may be added later for requests that local models cannot handle reliably.

The backend should orchestrate AI inference.

Mobile clients should upload audio rather than performing transcription locally.

The architecture should not be tightly coupled to Ollama, Whisper or any single model.

Define provider boundaries so local and cloud implementations can be exchanged with minimal changes.

Do not assume that every request requires an LLM.

Prefer deterministic parsing, validation and business logic whenever sufficient.

Use the smallest capable model for each task, escalating to larger or cloud-hosted models only when necessary.

## Mobile client

The intended mobile client is React Native.

Core mobile capabilities:

* authentication;
* switching between private and shared views;
* recording voice notes;
* uploading audio;
* reviewing and editing transcription when necessary;
* reviewing AI interpretation when confirmation is required;
* viewing and managing notes and tasks;
* receiving push notifications;
* viewing the daily digest;
* viewing tasks in a calendar view.

The first version may target iOS, but avoid unnecessary platform lock-in in the domain model and backend.

## Backend

The backend should provide:

* authentication and user isolation;
* note and task storage;
* audio file metadata and storage;
* transcription job handling;
* AI classification and structuring;
* scheduled digest generation;
* push-notification orchestration;
* auditability of AI suggestions, automated actions and user confirmations.

The implementation technology is intentionally left undecided at this stage.

The backend architecture, programming language, frameworks, database, deployment model and infrastructure should be selected during a dedicated architecture and technology evaluation phase.

The first version is for two users, so optimize for simplicity, maintainability and correctness rather than premature scale.

## Engineering principles

These are development principles, not preselected architectural solutions:

* Keep product requirements separate from implementation decisions.
* Prefer explicit schemas and runtime validation for AI output.
* Prefer TDD, especially when requirements are already specified.
* Write tests for authorization and private/shared-data boundaries.
* Store AI prompts and output schemas in version control.
* Make AI operations observable and reproducible where practical.
* Avoid introducing complexity without a clearly identified requirement or operational problem.
* Document the motivation, alternatives and trade-offs behind significant decisions.
* Record accepted decisions in `docs/decisions.md`.
* Keep unresolved decisions in `docs/open-questions.md`.
* Do not treat an AI-generated proposal as an accepted decision until it has been reviewed by the human project owner.

# GitHub planning model

Use GitHub Issues as the primary project backlog.

Create:

* epics for major product or technical workstreams;
* discovery issues for unresolved decisions;
* implementation issues for concrete deliverables;
* follow-up issues when new work is identified during implementation.

Use labels such as:

* `epic`;
* `discovery`;
* `architecture`;
* `product`;
* `backend`;
* `mobile`;
* `ai`;
* `infrastructure`;
* `security`;
* `testing`;
* `documentation`;
* `blocked`;
* `needs-human-input`;
* `ready`;
* `in-progress`.

Do not create an excessive number of tiny issues.

Each issue should represent a meaningful discussion, decision or deliverable.

Each issue should include:

* context;
* goal;
* scope;
* non-goals where useful;
* open questions;
* expected output;
* acceptance criteria;
* dependencies;
* relevant documents;
* whether human input is required.

Use GitHub issue relationships, checklists or references to connect implementation issues to their epic.

# Human-guided discovery

The first project tasks should be discovery and architecture tasks that require active discussion with the human project owner.

These tasks must not be resolved silently by Codex.

Use an interview-style process similar in spirit to a rigorous "grill me" workflow:

1. Present one decision area at a time.
2. Ask concrete, high-value questions.
3. Challenge assumptions when appropriate.
4. Explain meaningful alternatives and trade-offs.
5. Avoid asking broad questions that can be answered more effectively through specific scenarios.
6. Record conclusions only after the human has reviewed them.
7. Update the relevant documentation and decision record after agreement.
8. Create follow-up issues when a decision uncovers additional work.

Do not ask the human to choose technologies without first explaining what problem each option solves.

Do not combine many unrelated architectural decisions into one discussion.

Each discovery issue should produce one or more of:

* clarified requirements;
* an accepted decision;
* a documented experiment;
* a benchmark;
* a proof of concept;
* a follow-up decision issue;
* a decision to postpone the choice.

# Initial project phases

## Phase 0 — Repository and AI development workspace

Goals:

* establish version control;
* create or connect the GitHub repository;
* create the documentation structure;
* create `AGENTS.md`;
* define the AI-assisted development workflow;
* define GitHub conventions;
* create the initial backlog;
* make the project understandable to a new Codex session.

Tasks should include:

* initialize Git if needed;
* create `.gitignore`;
* create the initial documentation files;
* create `AGENTS.md`;
* create the GitHub repository or connect the existing one;
* configure the remote;
* push the initial commits;
* create GitHub labels;
* create initial epics and discovery issues;
* document how Codex should select and work on issues.

Completion criteria:

* the repository is available on GitHub;
* documentation exists and reflects the known product context;
* unresolved decisions are explicitly listed;
* the initial GitHub backlog exists;
* no product features have been implemented.

## Phase 1 — Product and architecture discovery

This phase should be composed primarily of GitHub discovery issues requiring human participation.

Create separate issues for at least the following areas:

### Product behavior

* define the boundary between private and shared information;
* define sharing and ownership rules;
* define when AI actions may run automatically;
* define which actions always require confirmation;
* define task, note, reminder and event relationships;
* define the expected morning-digest behavior;
* define the minimum useful first release.

### Client architecture

* clarify the initial target devices;
* clarify whether both users use separate devices and accounts;
* evaluate mobile-client architecture;
* evaluate notification and deep-link requirements;
* clarify offline behavior and synchronization expectations.

React Native is currently the intended direction, but the concrete setup and supporting libraries should be evaluated during this phase.

### Backend architecture

* identify backend responsibilities and boundaries;
* evaluate programming-language and framework options;
* evaluate synchronous and asynchronous job-processing needs;
* evaluate the deployment model;
* evaluate how the backend communicates with local AI services;
* identify reliability and operational requirements for a two-user private system.

Do not assume a specific backend language or framework before completing the relevant discovery issue.

### Data architecture

* define the initial domain model;
* evaluate database options;
* define user isolation and ownership rules;
* define auditability requirements;
* define audio-file storage;
* define backup and recovery expectations;
* define data retention behavior.

### AI architecture

* evaluate Ollama and alternative local runtimes;
* benchmark appropriate Qwen models on the available M1 Pro;
* evaluate local Whisper implementations;
* define AI provider boundaries;
* define structured-output schemas;
* define confidence and ambiguity handling;
* define escalation criteria for larger or cloud-hosted models;
* define observability and evaluation requirements.

### Infrastructure and operations

* decide whether the home Mac is:

  * the complete application server;
  * only an AI inference worker;
  * a development-only machine;
* evaluate remote access requirements;
* evaluate availability when the Mac is sleeping or offline;
* evaluate push-notification infrastructure;
* define secret management;
* define backup, update and recovery procedures.

Each discovery issue must explicitly state that it requires human review before closure.

Completion criteria:

* major product ambiguities have been clarified;
* the initial architecture has been documented;
* major decisions have rationale;
* deferred decisions are explicitly documented;
* implementation epics have been refined;
* the first vertical slice is defined.

## Phase 2 — First vertical slice

Do not fully plan this phase until Phase 1 has been reviewed.

The likely first vertical slice should validate the core deterministic application behavior before advanced AI automation.

Candidate scope:

* two separate users;
* authentication;
* private and shared ownership boundaries;
* manual text-note creation;
* creation of a simple task from a note;
* task viewing and completion;
* tests for authorization and private/shared-data isolation.

The exact scope must be confirmed during product and architecture discovery.

## Phase 3 — Voice capture and local AI

Candidate scope:

* mobile voice recording;
* audio upload;
* local backend transcription with Whisper;
* transcription confidence handling;
* optional transcription correction;
* AI classification and structured extraction;
* automatic execution of low-risk, high-confidence actions;
* confirmation flow for ambiguous or consequential actions;
* storage of original audio, transcription, AI interpretation and action history.

## Phase 4 — Reminders, digest and notifications

Candidate scope:

* reminder scheduling;
* morning-digest generation;
* push notifications when the application is closed;
* deep links to digest and task screens;
* user-specific digest contents;
* shared-task digest behavior;
* task calendar view.

## Phase 5 — Contextual intelligence

Candidate scope:

* linking new notes to existing tasks;
* additional instructions for existing items;
* smarter planning;
* accumulated-context summarization;
* local-to-cloud model escalation;
* usage-based improvements;
* AI evaluation and routing improvements.

# Initial GitHub epics

Create initial epic issues corresponding approximately to:

1. Project foundation and AI development workflow.
2. Product discovery and domain definition.
3. Architecture and technology evaluation.
4. Identity, privacy and shared-data boundaries.
5. Core notes and task management.
6. Voice capture and transcription.
7. AI classification and automated actions.
8. Reminders, digest and push notifications.
9. Deployment, operations and backups.
10. Quality, security and observability.

The exact epic names may be refined, but preserve these concerns.

# Initial priority issues

The first issues in the backlog should focus on establishing the project and resolving decisions rather than implementing features.

Create high-priority issues similar to:

1. Initialize Git repository and connect GitHub.
2. Create the AI-agent documentation workspace.
3. Define the GitHub issue and development workflow.
4. Review and refine the product context with the human owner.
5. Define the minimum useful first release.
6. Define private versus shared ownership behavior.
7. Define automatic-action and confirmation rules.
8. Define the initial domain concepts and their relationships.
9. Evaluate backend architecture and technology options.
10. Evaluate database and storage options.
11. Evaluate local AI runtime and models on M1 Pro.
12. Evaluate local Whisper implementation.
13. Evaluate deployment and home-Mac availability options.
14. Define the first vertical slice.
15. Convert accepted decisions into implementation issues.

Issues 4 through 14 should generally include the labels:

* `discovery`;
* `needs-human-input`;
* one or more relevant domain labels.

They should not be closed until the human owner has reviewed their outcomes.

# Working from issues

After project initialization and discovery:

1. Select a `ready` GitHub Issue.
2. Read all linked documentation and decisions.
3. Confirm that dependencies are resolved.
4. Create a focused branch.
5. Restate the issue scope before implementation.
6. Prefer tests first when the behavior is specified.
7. Implement only the approved scope.
8. Run relevant validation.
9. Update documentation when necessary.
10. Create a pull request linked to the issue.
11. Summarize decisions, trade-offs, testing and unresolved concerns.
12. Do not merge automatically unless explicitly instructed.

If an implementation task uncovers a new architecture or product decision, stop treating it as an implementation detail.

Create or reference a discovery issue and request human input.

# Non-goals for the first version

Do not initially build:

* a public multi-tenant SaaS platform;
* team or organization administration;
* autonomous execution of consequential actions;
* complex agent swarms;
* a general-purpose chatbot;
* automatic sharing of private notes;
* sophisticated semantic memory before the basic workflows work reliably;
* infrastructure justified only by hypothetical future scale.

# Important unresolved decisions

Document these in `docs/open-questions.md` and create appropriate discovery issues.

Do not silently resolve them:

* exact private versus shared ownership rules;
* authentication method;
* whether both users always use separate accounts and devices;
* whether shared items have one owner or multiple participants;
* where audio files will be stored;
* whether the home Mac acts as a permanent server, an AI inference worker or only a development machine;
* backend language and framework;
* database choice;
* deployment model;
* job-processing model;
* local Whisper implementation;
* push-notification provider;
* backup and recovery strategy;
* whether notes, tasks, reminders and calendar events are separate entities;
* how transcription confidence should be measured;
* which actions may execute automatically;
* which actions always require confirmation;
* how the system determines when to escalate from a local model to a larger or cloud-hosted model;
* what belongs in the minimum useful first release.

# Expected output from this initialization task

Before making feature-level implementation changes, provide:

1. The resulting repository tree.
2. A summary of created documentation.
3. A list of Git commits created.
4. The GitHub repository status.
5. The GitHub labels created.
6. The epics and issues created.
7. The proposed ordering of the first discovery issues.
8. Any blockers or operations that could not be completed.
9. Any assumptions made.
10. A clear request for my review before proceeding to product or architecture discovery.

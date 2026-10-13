import { responseError } from "../http/request-error";

export type ReviewOutcome =
  | { readonly kind: "task"; readonly id: string; readonly title: string; readonly dueAt?: string; readonly status: "open" | "completed"; readonly version: number }
  | { readonly kind: "note"; readonly id: string; readonly content: string; readonly reviewState: "none" | "needs_review"; readonly version: number };

export interface ReviewContract {
  readonly state: "pending" | "failed" | "completed" | "needs_review";
  readonly capture: { readonly id: string; readonly memberId: string };
  readonly source: {
    readonly id: string;
    readonly content?: { readonly kind: "audio"; readonly contentType: string; readonly byteLength: number; readonly sha256: string };
    readonly storageState?: "pending" | "stored";
  };
  readonly transcription: { readonly status: string; readonly text?: string; readonly language?: string } | null;
  readonly correction: { readonly text: string } | null;
  readonly interpretation: { readonly id: string; readonly classification?: string } | null;
  readonly interpretationProcessing?: {
    readonly status: "pending" | "processing" | "succeeded" | "failed";
    readonly attemptCount: number;
    readonly retryable: boolean;
  } | null;
  readonly outcome: ReviewOutcome | null;
  readonly failure: {
    readonly stage: "capture" | "transcription" | "interpretation";
    readonly message: string;
    readonly retryable?: boolean;
  } | null;
}

export interface ReviewClient {
  get(detailUrl: string): Promise<ReviewContract>;
  updateTask(taskId: string, memberId: string, expectedVersion: number, changes: { readonly title?: string; readonly dueAt?: string | null }): Promise<ReviewOutcome>;
  completeTask(taskId: string, memberId: string, expectedVersion: number): Promise<ReviewOutcome>;
  /** Optional until the backend reopening contract is available. */
  reopenTask?: (taskId: string, memberId: string, expectedVersion: number) => Promise<Extract<ReviewOutcome, { readonly kind: "task" }>>;
  updateNote(noteId: string, memberId: string, expectedVersion: number, content: string): Promise<ReviewOutcome>;
  convertNoteToTask(noteId: string, memberId: string, expectedVersion: number): Promise<Extract<ReviewOutcome, { readonly kind: "task" }>>;
}

export function createReviewClient(apiBaseUrl: string): ReviewClient {
  return {
    async get(detailUrl) {
      const response = await fetch(url(apiBaseUrl, detailUrl));
      return readResponse<{ review: ReviewContract }>(response).then((body) => body.review);
    },
    async updateTask(taskId, memberId, expectedVersion, changes) {
      const response = await fetch(url(apiBaseUrl, `/tasks/${taskId}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, expectedVersion, ...changes }) });
      return readResponse<{ task: ReviewOutcome }>(response).then((body) => body.task);
    },
    async completeTask(taskId, memberId, expectedVersion) {
      const response = await fetch(url(apiBaseUrl, `/tasks/${taskId}/complete`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, expectedVersion }) });
      return readResponse<{ task: ReviewOutcome }>(response).then((body) => body.task);
    },
    async updateNote(noteId, memberId, expectedVersion, content) {
      const response = await fetch(url(apiBaseUrl, `/notes/${noteId}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, expectedVersion, content }) });
      return readResponse<{ note: ReviewOutcome }>(response).then((body) => body.note);
    },
    async convertNoteToTask(noteId, memberId, expectedVersion) {
      const response = await fetch(url(apiBaseUrl, `/notes/${noteId}/convert-to-task`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, expectedVersion }) });
      return readResponse<{ task: Extract<ReviewOutcome, { readonly kind: "task" }> }>(response).then((body) => body.task);
    },
  };
}

export function createReviewFixtureClient(kind: "task" | "note", initialOutcome?: ReviewOutcome): ReviewClient {
  let outcome: ReviewOutcome = initialOutcome ?? (kind === "task"
    ? { kind: "task", id: "demo-task-1", title: "Buy milk", status: "open", version: 0 }
    : { kind: "note", id: "demo-note-1", content: "Call the dentist", reviewState: "needs_review", version: 0 });
  return {
    async get() {
      return { state: outcome.kind === "note" ? "needs_review" : "completed", capture: { id: "demo-capture-1", memberId: "member-1" }, source: { id: "demo-source-1" }, transcription: { status: "succeeded", text: "Demo source transcription" }, correction: null, interpretation: { id: "demo-interpretation-1", classification: outcome.kind === "task" ? "clear_supported" : "ambiguous" }, outcome, failure: null };
    },
    async updateTask(_taskId, _memberId, _expectedVersion, changes) {
      if (outcome.kind !== "task") throw new Error("Demo fixture is a Note");
      const next = { ...outcome, ...(changes.title === undefined ? {} : { title: changes.title }) };
      if (changes.dueAt === null) {
        const { dueAt: _dueAt, ...withoutDueAt } = next;
        outcome = { ...withoutDueAt, version: outcome.version + 1 };
      } else {
        outcome = { ...next, ...(changes.dueAt === undefined ? {} : { dueAt: changes.dueAt }), version: outcome.version + 1 };
      }
      return outcome;
    },
    async completeTask() {
      if (outcome.kind !== "task") throw new Error("Demo fixture is a Note");
      outcome = { ...outcome, status: "completed", version: outcome.version + 1 };
      return outcome;
    },
    async reopenTask() {
      if (outcome.kind !== "task") throw new Error("Demo fixture is a Note");
      outcome = { ...outcome, status: "open", version: outcome.version + 1 };
      return outcome;
    },
    async updateNote(_noteId, _memberId, _expectedVersion, content) {
      if (outcome.kind !== "note") throw new Error("Demo fixture is a Task");
      outcome = { ...outcome, content, reviewState: "none", version: outcome.version + 1 };
      return outcome;
    },
    async convertNoteToTask() {
      if (outcome.kind !== "note") throw new Error("Demo fixture is a Task");
      outcome = { kind: "task", id: outcome.id, title: outcome.content, status: "open", version: outcome.version + 1 };
      return outcome;
    },
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
    throw responseError(message, response.status);
  }
  return body as T;
}

function url(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

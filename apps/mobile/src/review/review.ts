export type ReviewOutcome =
  | { readonly kind: "task"; readonly id: string; readonly title: string; readonly dueAt?: string; readonly status: "open" | "completed"; readonly version: number }
  | { readonly kind: "note"; readonly id: string; readonly content: string; readonly reviewState: "none" | "needs_review"; readonly version: number };

export interface ReviewContract {
  readonly state: "pending" | "failed" | "completed" | "needs_review";
  readonly capture: { readonly id: string; readonly memberId: string };
  readonly source: { readonly id: string };
  readonly transcription: { readonly status: string; readonly text?: string } | null;
  readonly correction: { readonly text: string } | null;
  readonly interpretation: { readonly id: string; readonly classification?: string } | null;
  readonly outcome: ReviewOutcome | null;
  readonly failure: { readonly stage: "capture" | "transcription"; readonly message: string } | null;
}

export interface ReviewClient {
  get(detailUrl: string): Promise<ReviewContract>;
  updateTask(taskId: string, memberId: string, expectedVersion: number, changes: { readonly title?: string; readonly dueAt?: string | null }): Promise<ReviewOutcome>;
  updateNote(noteId: string, memberId: string, expectedVersion: number, content: string): Promise<ReviewOutcome>;
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
    async updateNote(noteId, memberId, expectedVersion, content) {
      const response = await fetch(url(apiBaseUrl, `/notes/${noteId}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, expectedVersion, content }) });
      return readResponse<{ note: ReviewOutcome }>(response).then((body) => body.note);
    },
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  return body as T;
}

function url(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

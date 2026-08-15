import { describe, expect, test, vi } from "vitest";

import { createReviewClient } from "./review";

describe("review client", () => {
  test("loads the review contract from an item detail URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ review: { state: "completed", capture: { id: "capture-1", memberId: "member-1" }, source: { id: "source-1" }, transcription: null, correction: null, interpretation: null, outcome: null, failure: null } }), { status: 200 })));

    await expect(createReviewClient("http://api.test/").get("/captures/capture-1/review")).resolves.toMatchObject({ state: "completed" });
    expect(fetch).toHaveBeenCalledWith("http://api.test/captures/capture-1/review");
  });

  test("sends only editable Task fields with the current version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: { kind: "task", id: "task-1" } }), { status: 200 })));

    await createReviewClient("http://api.test").updateTask("task-1", "member-1", 3, { title: "Buy bread", dueAt: null });

    expect(fetch).toHaveBeenCalledWith("http://api.test/tasks/task-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ memberId: "member-1", expectedVersion: 3, title: "Buy bread", dueAt: null }) }));
  });

  test("completes a Task through the reviewed mutation contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: { kind: "task", id: "task-1", status: "completed" } }), { status: 200 })));

    await createReviewClient("http://api.test").completeTask("task-1", "member-1", 3);

    expect(fetch).toHaveBeenCalledWith("http://api.test/tasks/task-1/complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ memberId: "member-1", expectedVersion: 3 }) }));
  });

  test("converts a Note through the reviewed in-place mutation contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ task: { kind: "task", id: "note-1", title: "Call the dentist", status: "open", version: 2 } }), { status: 200 })));

    await createReviewClient("http://api.test").convertNoteToTask("note-1", "member-1", 1);

    expect(fetch).toHaveBeenCalledWith("http://api.test/notes/note-1/convert-to-task", expect.objectContaining({ method: "POST", body: JSON.stringify({ memberId: "member-1", expectedVersion: 1 }) }));
  });

  test("surfaces server validation failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "title must not be empty" }), { status: 400 })));

    await expect(createReviewClient("http://api.test").updateNote("note-1", "member-1", 1, "")).rejects.toThrow("title must not be empty");
  });
});

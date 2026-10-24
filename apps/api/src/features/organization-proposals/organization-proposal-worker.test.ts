import { describe, expect, test } from "vitest";
import { OrganizationProposalWorker, type OrganizationProposalGenerator, type OrganizationProposalJob, type OrganizationProposalJobRepository, type OrganizationProposalWorkerOptions } from "./organization-proposal-worker.js";
import { OrganizationProposalService, type OrganizationProposal } from "./organization-proposal.js";

function harness(generate: OrganizationProposalGenerator["generate"] = async () => ({ modelVersion: "test-model", candidates: [] }), spaces: OrganizationProposalWorkerOptions["spaces"] = { list: () => [] }) {
  const jobs: OrganizationProposalJob[] = [];
  const repository: OrganizationProposalJobRepository = {
    create: (job) => { const existing = jobs.find((value) => value.itemId === job.itemId); if (existing) return existing; jobs.push(job); return job; },
    find: (memberId, itemId) => jobs.find((value) => value.memberId === memberId && value.itemId === itemId),
    recoverable: () => jobs.filter((value) => value.status === "pending" || value.status === "processing" || (value.status === "failed" && value.retryable)),
    markProcessing: (memberId, itemId) => { const index = jobs.findIndex((value) => value.memberId === memberId && value.itemId === itemId); const updated = { ...jobs[index]!, status: "processing" as const, attemptCount: jobs[index]!.attemptCount + 1 }; jobs[index] = updated; return updated; },
    complete: (memberId, itemId) => { const index = jobs.findIndex((value) => value.memberId === memberId && value.itemId === itemId); const updated = { ...jobs[index]!, status: "succeeded" as const, retryable: false }; jobs[index] = updated; return updated; },
    fail: (memberId, itemId, error, retryable) => { const index = jobs.findIndex((value) => value.memberId === memberId && value.itemId === itemId); const updated = { ...jobs[index]!, status: "failed" as const, error, retryable }; jobs[index] = updated; return updated; },
    retry: (memberId, itemId) => { const index = jobs.findIndex((value) => value.memberId === memberId && value.itemId === itemId); if (index < 0 || !jobs[index]!.retryable) return undefined; const { error: _error, ...job } = jobs[index]!; const updated = { ...job, status: "pending" as const }; jobs[index] = updated; return updated; },
  };
  const proposals: OrganizationProposal[] = [];
  const proposalRepository = {
    findByIdempotencyKey: (memberId: string, key: string) => proposals.find((proposal) => proposal.memberId === memberId && proposal.idempotencyKey === key),
    findById: () => undefined,
    listForItem: (memberId: string, itemId: string, kind: "task" | "note") => proposals.filter((proposal) => proposal.memberId === memberId && proposal.itemId === itemId && proposal.itemKind === kind),
    create: (proposal: OrganizationProposal) => { proposals.push(proposal); return proposal; }, updateDecision: () => undefined, deleteSuggested: () => undefined,
  };
  const proposalService = new OrganizationProposalService(proposalRepository, {
    metadataService: { listTags: () => [], listEntities: () => [], createTag: () => { throw new Error("unused"); }, createEntity: () => { throw new Error("unused"); }, linkTag: () => ({ tags: [], entities: [] }), linkEntity: () => ({ tags: [], entities: [] }) },
    spaceService: { assign: (itemId: string, itemKind: "task" | "note", _memberId: string, spaceId: string | null) => ({ itemId, itemKind, spaceId: spaceId ?? "" }) },
  });
  const worker = new OrganizationProposalWorker({ repository, proposalService, provider: { generate }, spaces, metadata: { listTags: () => [], listEntities: () => [] }, maxAttempts: 2 });
  return { worker, jobs, proposals };
}

describe("OrganizationProposalWorker", () => {
  test("queues only durable outcomes and resolves empty generation separately from pending", async () => {
    const context = { spaces: [], tags: [], entities: [] };
    const pending = harness(async ({ item }) => { expect(item.id).toBe("note-1"); return { modelVersion: "qwen-test", candidates: [] }; });
    await pending.worker.start();
    pending.worker.outcomeCreated({ id: "note-1", memberId: "member-1", kind: "note", content: "remember milk", interpretationId: "i-1", captureId: "c-1", sourceId: "s-1", reviewState: "none", version: 0, createdAt: "now" }, "remember milk");
    expect(pending.worker.status("member-1", "note-1", "note").state).toBe("pending");
    await pending.worker.drain();
    expect(pending.worker.status("member-1", "note-1", "note").state).toBe("completed_empty");
    expect(context).toEqual({ spaces: [], tags: [], entities: [] });
    await pending.worker.stop();
  });

  test("reports a retryable provider failure without affecting the durable item", async () => {
    const failed = harness(async () => { throw new Error("provider offline"); });
    await failed.worker.start();
    failed.worker.outcomeCreated({ id: "task-1", memberId: "member-1", kind: "task", title: "Buy milk", status: "open", version: 0, createdAt: "now", interpretationId: "i-1", captureId: "c-1", sourceId: "s-1" }, "remind me to buy milk");
    await failed.worker.drain();
    expect(failed.worker.status("member-1", "task-1", "task")).toMatchObject({ state: "failed", retryable: true });
    expect(failed.jobs[0]).toMatchObject({ itemId: "task-1", status: "failed" });
    await failed.worker.stop();
  });

  test("retries the same durable generation job without duplicate proposals", async () => {
    let calls = 0;
    const retrying = harness(async () => { calls += 1; if (calls === 1) throw new Error("provider offline"); return { modelVersion: "test-model", candidates: [] }; });
    await retrying.worker.start();
    retrying.worker.outcomeCreated({ id: "note-2", memberId: "member-1", kind: "note", content: "Dinner Friday", interpretationId: "i-2", captureId: "c-2", sourceId: "s-2", reviewState: "none", version: 0, createdAt: "now" }, "Dinner Friday");
    await retrying.worker.drain();
    expect(retrying.worker.status("member-1", "note-2", "note").state).toBe("failed");
    retrying.worker.retry("member-1", "note-2");
    await retrying.worker.drain();
    expect(retrying.worker.status("member-1", "note-2", "note").state).toBe("completed_empty");
    expect(calls).toBe(2);
    expect(retrying.proposals).toHaveLength(0);
    await retrying.worker.stop();
  });

  test("persists existing and temporary candidates with confidence bands, provenance, and versions", async () => {
    const candidates = [
      { kind: "tag" as const, targetId: "tag-1", confidence: 0.8, provenance: ["transcription: groceries"] },
      { kind: "tag" as const, suggestedName: "errands", confidence: 0.5, provenance: ["transcription: stop by post office"] },
      { kind: "entity" as const, suggestedName: "Ava", entityType: "Person", confidence: 0.49, provenance: ["transcription: Ava"] },
    ];
    const generated = harness(async () => ({ modelVersion: "qwen-local-v3", candidates }));
    await generated.worker.start();
    generated.worker.outcomeCreated({ id: "note-3", memberId: "member-1", kind: "note", content: "Post office with Ava", interpretationId: "i-3", captureId: "c-3", sourceId: "s-3", reviewState: "none", version: 0, createdAt: "now" }, "Stop by the post office with Ava");
    await generated.worker.drain();
    expect(generated.worker.status("member-1", "note-3", "note")).toMatchObject({ state: "ready", proposals: [{ modelVersion: "qwen-local-v3", rulesVersion: "organization-proposals.v1", candidates: [{ confidenceBand: "high", state: "accepted", provenance: ["transcription: groceries"] }, { confidenceBand: "medium", state: "pending", suggestedName: "errands" }, { confidenceBand: "low", state: "pending", entityType: "Person" }] }] });
    expect(generated.proposals).toHaveLength(1);
    await generated.worker.stop();
  });

  test("includes examples from the owning Member's existing Space assignments", async () => {
    const space = { id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" };
    const spaces: OrganizationProposalWorkerOptions["spaces"] = {
      list: (memberId) => { expect(memberId).toBe("member-1"); return [space]; },
      read: (_memberId, spaceId) => ({ space, path: "Home", children: [], items: [{ itemId: "note-existing", itemKind: "note", spaceId, content: "Remember the front door key", path: "Home" }] }),
    };
    const generated = harness(async ({ context }) => { expect(context.spaces).toEqual([{ id: "space-1", name: "Home", path: "Home", examples: ["Remember the front door key"] }]); return { modelVersion: "test-model", candidates: [] }; }, spaces);
    await generated.worker.start();
    generated.worker.outcomeCreated({ id: "note-context", memberId: "member-1", kind: "note", content: "New note", interpretationId: "i-context", captureId: "c-context", sourceId: "s-context", reviewState: "none", version: 0, createdAt: "now" }, "New note");
    await generated.worker.drain();
    await generated.worker.stop();
  });
});

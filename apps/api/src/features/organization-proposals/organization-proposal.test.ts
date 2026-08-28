import { describe, expect, test } from "vitest";
import { OrganizationProposalService, type CandidateState, type OrganizationProposal, type OrganizationProposalRepository } from "./organization-proposal.js";

function repository(): OrganizationProposalRepository & { values: OrganizationProposal[] } {
  const values: OrganizationProposal[] = [];
  return {
    values,
    findByIdempotencyKey: (_member, key) => values.find((value) => value.idempotencyKey === key),
    findById: (_member, id) => values.find((value) => value.id === id),
    listForItem: (_member, itemId, kind) => values.filter((value) => value.itemId === itemId && value.itemKind === kind),
    create: (value) => { values.push(value); return value; },
    updateDecision: (member, id, state, ids) => { const value = values.find((item) => item.memberId === member && item.id === id); if (!value) return undefined; const selected = new Set(ids); const result: OrganizationProposal = { ...value, state, updatedAt: "later", candidates: value.candidates.map((candidate) => ({ ...candidate, state: (state === "dismissed" ? "dismissed" : selected.size === 0 || selected.has(candidate.id) ? "accepted" : "dismissed") as CandidateState })) }; values.splice(values.indexOf(value), 1, result); return result; },
    deleteSuggested: () => undefined,
  };
}

describe("OrganizationProposalService", () => {
  test("bands candidates, preserves context input, and is idempotent", () => {
    const repo = repository(); const service = new OrganizationProposalService(repo);
    const input = { memberId: "member-1", itemId: "note-1", itemKind: "note" as const, idempotencyKey: "capture-1:v1", modelVersion: "qwen", rulesVersion: "organization.v1", context: { spaces: [{ id: "space-1", name: "Home", path: "Home", description: "home", examples: ["keys"] }], tags: [{ id: "tag-1", name: "garden" }], entities: [{ id: "entity-1", name: "Alice", aliases: ["Al"] }] }, candidates: [{ kind: "space" as const, targetId: "space-1", confidence: 0.9, provenance: ["transcription"] }, { kind: "tag" as const, suggestedName: "plants", confidence: 0.6, provenance: ["transcription", "rules"] }, { kind: "entity" as const, suggestedName: "Unknown", confidence: 0.2, provenance: ["model"] }] };
    const first = service.create(input); const second = service.create(input);
    expect(second).toBe(first); expect(first.state).toBe("pending"); expect(first.candidates.map((candidate) => candidate.confidenceBand)).toEqual(["high", "medium", "low"]);
  });
  test("does not create actionable work for empty or only low-confidence results", () => {
    const repo = repository(); const service = new OrganizationProposalService(repo);
    const result = service.create({ memberId: "m", itemId: "n", itemKind: "note", idempotencyKey: "k", modelVersion: "m", rulesVersion: "r", context: { spaces: [], tags: [], entities: [] }, candidates: [] });
    expect(result.state).toBe("dismissed");
  });

  test("applies high-confidence existing candidates and accepts suggested metadata idempotently", () => {
    const repo = repository(); const links: string[] = []; const tags = [{ id: "tag-1", memberId: "member-1", name: "existing", createdAt: "now" }];
    const metadataService = { listTags: () => tags, listEntities: () => [], createTag: (_member: string, name: string) => { const tag = { id: "tag-new", memberId: "member-1", name, createdAt: "now" }; tags.push(tag); return tag; }, createEntity: () => { throw new Error("not used"); }, linkTag: (_item: string, _kind: "note" | "task", _member: string, id: string) => { links.push(`tag:${id}`); return { tags: [], entities: [] }; }, linkEntity: () => ({ tags: [], entities: [] }) };
    const spaceService = { assign: (_item: string, _kind: "note" | "task", _member: string, id: string) => { links.push(`space:${id}`); return { itemId: "note-1", itemKind: "note" as const, spaceId: id }; } };
    const service = new OrganizationProposalService(repo, { metadataService, spaceService });
    const proposal = service.create({ memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "k", modelVersion: "qwen", rulesVersion: "r", context: { spaces: [], tags: [], entities: [] }, candidates: [{ kind: "space", targetId: "space-1", confidence: 0.9, provenance: ["rules"] }, { kind: "tag", suggestedName: "new", confidence: 0.6, provenance: ["model"] }] });
    expect(links).toEqual(["space:space-1"]);
    service.decide("member-1", proposal.id, "accepted"); service.decide("member-1", proposal.id, "accepted");
    expect(links).toEqual(["space:space-1", "tag:tag-new"]); expect(tags).toHaveLength(2);
  });
});

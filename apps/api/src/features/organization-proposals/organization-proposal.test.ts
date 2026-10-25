import { describe, expect, test } from "vitest";
import { OrganizationProposalService, type CandidateState, type OrganizationProposal, type OrganizationProposalRepository } from "./organization-proposal.js";

const unusedAssignments = { metadataService: { listTags: () => [], listEntities: () => [], createTag: () => ({ id: "unused", memberId: "unused", name: "unused", createdAt: "now" }), createEntity: () => ({ id: "unused", memberId: "unused", name: "unused", type: "Object" as const, createdAt: "now" }), linkTag: () => ({ tags: [], entities: [] }), linkEntity: () => ({ tags: [], entities: [] }) }, spaceService: { assign: () => ({ itemId: "unused", itemKind: "note" as const, spaceId: null }), create: () => ({ id: "unused", memberId: "unused", name: "unused", createdAt: "now" }), list: () => [] } };

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
    const repo = repository(); const service = new OrganizationProposalService(repo, unusedAssignments);
    const input = { memberId: "member-1", itemId: "note-1", itemKind: "note" as const, idempotencyKey: "capture-1:v1", modelVersion: "qwen", rulesVersion: "organization.v1", context: { spaces: [{ id: "space-1", name: "Home", path: "Home", description: "home", examples: ["keys"] }], tags: [{ id: "tag-1", name: "garden" }], entities: [{ id: "entity-1", name: "Alice", type: "Person", aliases: ["Al"] }] }, candidates: [{ kind: "space" as const, targetId: "space-1", confidence: 0.9, provenance: ["transcription"] }, { kind: "tag" as const, suggestedName: "plants", confidence: 0.6, provenance: ["transcription", "rules"] }, { kind: "entity" as const, suggestedName: "Unknown", entityType: "Person", confidence: 0.2, provenance: ["model"] }] };
    const first = service.create(input); const second = service.create(input);
    expect(second).toBe(first); expect(first.state).toBe("pending"); expect(first.candidates.map((candidate) => candidate.confidenceBand)).toEqual(["high", "medium", "low"]);
  });
  test("does not create actionable work for empty or only low-confidence results", () => {
    const repo = repository(); const service = new OrganizationProposalService(repo, unusedAssignments);
    const result = service.create({ memberId: "m", itemId: "n", itemKind: "note", idempotencyKey: "k", modelVersion: "m", rulesVersion: "r", context: { spaces: [], tags: [], entities: [] }, candidates: [] });
    expect(result.state).toBe("dismissed");
  });

  test("applies high-confidence existing candidates and accepts suggested metadata idempotently", () => {
    const repo = repository(); const links: string[] = []; const tags = [{ id: "tag-1", memberId: "member-1", name: "existing", createdAt: "now" }];
    const metadataService = { listTags: () => tags, listEntities: () => [], createTag: (_member: string, name: string) => { const tag = { id: "tag-new", memberId: "member-1", name, createdAt: "now" }; tags.push(tag); return tag; }, createEntity: () => { throw new Error("not used"); }, linkTag: (_item: string, _kind: "note" | "task", _member: string, id: string) => { links.push(`tag:${id}`); return { tags: [], entities: [] }; }, linkEntity: () => ({ tags: [], entities: [] }) };
    const spaceService = { assign: (_item: string, _kind: "note" | "task", _member: string, id: string) => { links.push(`space:${id}`); return { itemId: "note-1", itemKind: "note" as const, spaceId: id }; }, create: (_member: string, name: string) => ({ id: "space-new", memberId: "member-1", name, createdAt: "now" }), list: () => [] };
    const service = new OrganizationProposalService(repo, { metadataService, spaceService });
    const proposal = service.create({ memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "k", modelVersion: "qwen", rulesVersion: "r", context: { spaces: [{ id: "space-1", name: "Home", path: "Home", examples: [] }], tags: [], entities: [] }, candidates: [{ kind: "space", targetId: "space-1", confidence: 0.9, provenance: ["rules"] }, { kind: "tag", suggestedName: "new", confidence: 0.6, provenance: ["model"] }] });
    expect(links).toEqual(["space:space-1"]);
    service.decide("member-1", proposal.id, "accepted"); service.decide("member-1", proposal.id, "accepted");
    expect(links).toEqual(["space:space-1", "tag:tag-new"]); expect(tags).toHaveLength(2);
  });

  test("keeps new names reviewable at every confidence and accepts a new Space only explicitly", () => {
    const repo = repository(); const created: string[] = []; const assigned: string[] = [];
    const service = new OrganizationProposalService(repo, { ...unusedAssignments, spaceService: { ...unusedAssignments.spaceService, list: () => [], create: (_member, name) => { created.push(name); return { id: "space-new", memberId: "member-1", name, createdAt: "now" }; }, assign: (_item, _kind, _member, id) => { assigned.push(id ?? ""); return { itemId: "note-1", itemKind: "note" as const, spaceId: id }; } } });
    const proposal = service.create({ memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "space", modelVersion: "qwen", rulesVersion: "r", context: { spaces: [], tags: [], entities: [] }, candidates: [{ kind: "space", suggestedName: "Office", confidence: 0.99, provenance: ["transcription"] }, { kind: "tag", suggestedName: "quiet", confidence: 0.2, provenance: ["transcription"] }] });
    expect(proposal.candidates.map(({ state }) => state)).toEqual(["pending", "pending"]);
    expect(created).toEqual([]);
    service.decide("member-1", proposal.id, "accepted", [proposal.candidates[0]!.id]);
    service.decide("member-1", proposal.id, "accepted", [proposal.candidates[0]!.id]);
    expect(created).toEqual(["Office"]);
    expect(assigned).toEqual(["space-new"]);
  });

  test("canonicalizes exact normalized duplicates without fuzzy merging", () => {
    const service = new OrganizationProposalService(repository(), unusedAssignments);
    const proposal = service.create({ memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "dupes", modelVersion: "qwen", rulesVersion: "r", context: { spaces: [{ id: "space-1", name: "Garden", path: "Home / Garden", examples: [] }], tags: [{ id: "tag-1", name: "Groceries" }], entities: [{ id: "entity-1", name: "Ava", type: "Person" }] }, candidates: [{ kind: "space", suggestedName: " home / garden ", confidence: 0.7, provenance: ["model"] }, { kind: "tag", suggestedName: " groceries ", confidence: 0.6, provenance: ["model"] }, { kind: "entity", suggestedName: "ava", entityType: "Person", confidence: 0.5, provenance: ["model"] }, { kind: "tag", suggestedName: "food shopping", confidence: 0.5, provenance: ["model"] }] });
    expect(proposal.candidates.map(({ targetId, suggestedName }) => [targetId, suggestedName])).toEqual([["space-1", undefined], ["tag-1", undefined], ["entity-1", undefined], [undefined, "food shopping"]]);
  });

  test("lets a Member accept a low-confidence existing target after review", () => {
    const repo = repository(); const assigned: string[] = [];
    const service = new OrganizationProposalService(repo, { ...unusedAssignments, spaceService: { ...unusedAssignments.spaceService, assign: (_item, _kind, _member, id) => { assigned.push(id ?? ""); return { itemId: "note-1", itemKind: "note" as const, spaceId: id }; } } });
    const proposal = service.create({ memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "review-low", modelVersion: "qwen", rulesVersion: "r", context: { spaces: [{ id: "space-1", name: "Home", path: "Home", examples: [] }], tags: [], entities: [] }, candidates: [{ kind: "space", targetId: "space-1", confidence: 0.2, provenance: ["model"] }] });
    expect(proposal.candidates[0]?.state).toBe("pending");
    service.decide("member-1", proposal.id, "accepted", [proposal.candidates[0]!.id]);
    expect(assigned).toEqual(["space-1"]);
  });
});

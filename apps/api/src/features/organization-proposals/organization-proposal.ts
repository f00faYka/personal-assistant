import { randomUUID } from "node:crypto";
import type { MetadataService } from "../metadata/metadata.js";
import type { SpaceService } from "../spaces/space.js";

export type OrganizationItemKind = "task" | "note";
export type OrganizationCandidateKind = "space" | "tag" | "entity";
export type ConfidenceBand = "high" | "medium" | "low";
export type ProposalState = "pending" | "accepted" | "dismissed";
export type CandidateState = "pending" | "accepted" | "dismissed";

export interface OrganizationContext {
  readonly spaces: readonly { readonly id: string; readonly name: string; readonly path: string; readonly description?: string; readonly examples: readonly string[] }[];
  readonly tags: readonly { readonly id: string; readonly name: string }[];
  readonly entities: readonly { readonly id: string; readonly name: string; readonly aliases?: readonly string[] }[];
}

export interface OrganizationCandidateInput {
  readonly kind: OrganizationCandidateKind;
  readonly confidence: number;
  readonly targetId?: string;
  readonly suggestedName?: string;
  readonly entityType?: string;
  readonly provenance: readonly string[];
}

export interface OrganizationProposalCandidate extends OrganizationCandidateInput {
  readonly id: string;
  readonly confidenceBand: ConfidenceBand;
  readonly state: CandidateState;
}

export interface OrganizationProposal {
  readonly id: string;
  readonly memberId: string;
  readonly itemId: string;
  readonly itemKind: OrganizationItemKind;
  readonly idempotencyKey: string;
  readonly modelVersion: string;
  readonly rulesVersion: string;
  readonly state: ProposalState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly candidates: readonly OrganizationProposalCandidate[];
}

export interface OrganizationProposalRepository {
  findByIdempotencyKey(memberId: string, key: string): OrganizationProposal | undefined;
  findById(memberId: string, id: string): OrganizationProposal | undefined;
  listForItem(memberId: string, itemId: string, itemKind: OrganizationItemKind): readonly OrganizationProposal[];
  create(proposal: OrganizationProposal): OrganizationProposal;
  updateDecision(memberId: string, proposalId: string, state: ProposalState, candidateIds: readonly string[]): OrganizationProposal | undefined;
  deleteSuggested(proposalId: string): void;
}

export interface OrganizationProposalAssignments {
  readonly metadataService: Pick<MetadataService, "listTags" | "listEntities" | "createTag" | "createEntity" | "linkTag" | "linkEntity">;
  readonly spaceService: Pick<SpaceService, "assign">;
}

export class OrganizationProposalNotFoundError extends Error {
  constructor(id: string) { super(`Organization proposal not found: ${id}`); this.name = "OrganizationProposalNotFoundError"; }
}
export class InvalidOrganizationProposalError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidOrganizationProposalError"; }
}

export class OrganizationProposalService {
  constructor(private readonly repository: OrganizationProposalRepository, private readonly assignments: OrganizationProposalAssignments) {}

  create(input: {
    readonly memberId: string; readonly itemId: string; readonly itemKind: OrganizationItemKind;
    readonly idempotencyKey: string; readonly modelVersion: string; readonly rulesVersion: string;
    readonly context: OrganizationContext; readonly candidates: readonly OrganizationCandidateInput[];
  }): OrganizationProposal {
    this.requireText(input.memberId, "memberId");
    this.requireText(input.itemId, "itemId");
    this.requireText(input.idempotencyKey, "idempotencyKey");
    this.requireText(input.modelVersion, "modelVersion");
    this.requireText(input.rulesVersion, "rulesVersion");
    if (!(["task", "note"] as const).includes(input.itemKind)) throw new InvalidOrganizationProposalError("invalid item kind");
    const existing = this.repository.findByIdempotencyKey(input.memberId, input.idempotencyKey);
    if (existing) return existing;
    const candidates = input.candidates.map((candidate) => {
      const normalized = this.candidate(candidate);
      return normalized.confidenceBand === "high" && normalized.targetId ? { ...normalized, state: "accepted" as const } : normalized;
    });
    const now = new Date().toISOString();
    const proposal = this.repository.create({
      id: randomUUID(), memberId: input.memberId, itemId: input.itemId, itemKind: input.itemKind,
      idempotencyKey: input.idempotencyKey, modelVersion: input.modelVersion, rulesVersion: input.rulesVersion,
      state: candidates.length === 0 || candidates.every((candidate) => candidate.confidenceBand === "low") ? "dismissed" : "pending",
      createdAt: now, updatedAt: now, candidates,
    });
    for (const candidate of proposal.candidates.filter((value) => value.confidenceBand === "high" && value.targetId)) this.applyExisting(proposal, candidate);
    return proposal;
  }

  list(memberId: string, itemId: string, itemKind: OrganizationItemKind): readonly OrganizationProposal[] {
    this.requireText(memberId, "memberId"); this.requireText(itemId, "itemId");
    return this.repository.listForItem(memberId, itemId, itemKind);
  }

  decide(memberId: string, proposalId: string, state: Extract<ProposalState, "accepted" | "dismissed">, candidateIds: readonly string[] = []): OrganizationProposal {
    this.requireText(memberId, "memberId");
    const proposal = this.repository.findById(memberId, proposalId);
    if (!proposal) throw new OrganizationProposalNotFoundError(proposalId);
    if (state === "accepted") {
      const selected = candidateIds.length ? new Set(candidateIds) : new Set(proposal.candidates.filter((candidate) => candidate.confidenceBand !== "low").map((candidate) => candidate.id));
      for (const candidate of proposal.candidates.filter((value) => selected.has(value.id) && value.state === "pending")) this.applyAccepted(proposal, candidate);
    }
    const updated = this.repository.updateDecision(memberId, proposalId, state, candidateIds);
    if (!updated) throw new OrganizationProposalNotFoundError(proposalId);
    this.repository.deleteSuggested(proposalId);
    return updated;
  }

  private applyAccepted(proposal: OrganizationProposal, candidate: OrganizationProposalCandidate): void {
    if (candidate.targetId) return this.applyExisting(proposal, candidate);
    if (!this.assignments || (candidate.kind !== "tag" && candidate.kind !== "entity")) throw new InvalidOrganizationProposalError("suggested Spaces cannot be accepted");
    if (candidate.kind === "tag") {
      const existing = this.assignments.metadataService.listTags(proposal.memberId).find((tag) => tag.name === candidate.suggestedName);
      const tag = existing ?? this.assignments.metadataService.createTag(proposal.memberId, candidate.suggestedName ?? "");
      this.assignments.metadataService.linkTag(proposal.itemId, proposal.itemKind, proposal.memberId, tag.id);
    } else {
      const existing = this.assignments.metadataService.listEntities(proposal.memberId).find((entity) => entity.name === candidate.suggestedName && entity.type === candidate.entityType);
      if (!candidate.entityType) throw new InvalidOrganizationProposalError("suggested Entity type is required");
      const entity = existing ?? this.assignments.metadataService.createEntity(proposal.memberId, candidate.suggestedName ?? "", candidate.entityType as Parameters<MetadataService["createEntity"]>[2]);
      this.assignments.metadataService.linkEntity(proposal.itemId, proposal.itemKind, proposal.memberId, entity.id);
    }
  }

  private applyExisting(proposal: OrganizationProposal, candidate: OrganizationProposalCandidate): void {
    if (!this.assignments || !candidate.targetId) return;
    if (candidate.kind === "space") this.assignments.spaceService.assign(proposal.itemId, proposal.itemKind, proposal.memberId, candidate.targetId);
    if (candidate.kind === "tag") this.assignments.metadataService.linkTag(proposal.itemId, proposal.itemKind, proposal.memberId, candidate.targetId);
    if (candidate.kind === "entity") this.assignments.metadataService.linkEntity(proposal.itemId, proposal.itemKind, proposal.memberId, candidate.targetId);
  }

  private candidate(input: OrganizationCandidateInput): OrganizationProposalCandidate {
    if (!["space", "tag", "entity"].includes(input.kind)) throw new InvalidOrganizationProposalError("invalid candidate kind");
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new InvalidOrganizationProposalError("confidence must be between 0 and 1");
    if (input.provenance.length === 0) throw new InvalidOrganizationProposalError("provenance is required");
    if (!input.targetId && !input.suggestedName) throw new InvalidOrganizationProposalError("candidate target or suggestion is required");
    return { ...input, id: randomUUID(), confidenceBand: input.confidence >= 0.8 ? "high" : input.confidence >= 0.5 ? "medium" : "low", state: "pending" };
  }
  private requireText(value: string, field: string): void { if (!value.trim()) throw new InvalidOrganizationProposalError(`${field} is required`); }
}

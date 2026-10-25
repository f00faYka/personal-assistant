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
  readonly entities: readonly { readonly id: string; readonly name: string; readonly type?: string; readonly aliases?: readonly string[] }[];
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
  readonly spaceService: Pick<SpaceService, "assign" | "create" | "list">;
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
    if (existing) {
      for (const candidate of existing.candidates.filter((value) => value.state === "accepted" && value.confidenceBand === "high" && value.targetId)) this.applyExisting(existing, candidate);
      return existing;
    }
    const candidates = input.candidates.map((candidate) => {
      const normalized = this.candidate(this.canonicalize(candidate, input.context));
      return normalized.confidenceBand === "high" && normalized.targetId ? { ...normalized, state: "accepted" as const } : normalized;
    });
    const now = new Date().toISOString();
    const proposal = this.repository.create({
      id: randomUUID(), memberId: input.memberId, itemId: input.itemId, itemKind: input.itemKind,
      idempotencyKey: input.idempotencyKey, modelVersion: input.modelVersion, rulesVersion: input.rulesVersion,
      state: candidates.length === 0 ? "dismissed" : "pending",
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
    if (!this.assignments) throw new InvalidOrganizationProposalError("proposal assignments are unavailable");
    if (candidate.kind === "space") {
      const name = candidate.suggestedName?.trim();
      if (!name) throw new InvalidOrganizationProposalError("empty_suggested_name");
      const existing = this.assignments.spaceService.list(proposal.memberId).find((space) => normalizeOrganizationName(space.name) === normalizeOrganizationName(name));
      const space = existing ?? this.assignments.spaceService.create(proposal.memberId, name);
      this.assignments.spaceService.assign(proposal.itemId, proposal.itemKind, proposal.memberId, space.id);
      return;
    }
    if (candidate.kind === "tag") {
      const existing = this.assignments.metadataService.listTags(proposal.memberId).find((tag) => normalizeOrganizationName(tag.name) === normalizeOrganizationName(candidate.suggestedName ?? ""));
      const tag = existing ?? this.assignments.metadataService.createTag(proposal.memberId, candidate.suggestedName ?? "");
      this.assignments.metadataService.linkTag(proposal.itemId, proposal.itemKind, proposal.memberId, tag.id);
    } else {
      const existing = this.assignments.metadataService.listEntities(proposal.memberId).find((entity) => normalizeOrganizationName(entity.name) === normalizeOrganizationName(candidate.suggestedName ?? "") && entity.type === candidate.entityType);
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
    if (Boolean(input.targetId) === Boolean(input.suggestedName)) throw new InvalidOrganizationProposalError("invalid_candidate_representation");
    if (input.suggestedName !== undefined && !input.suggestedName.trim()) throw new InvalidOrganizationProposalError("empty_suggested_name");
    if (input.entityType !== undefined && (input.kind !== "entity" || input.targetId !== undefined)) throw new InvalidOrganizationProposalError("invalid_entity_type_usage");
    if (input.kind === "entity" && input.suggestedName && !["Person", "Place", "Organization", "Object"].includes(input.entityType ?? "")) throw new InvalidOrganizationProposalError("invalid_new_entity_type");
    return { ...input, id: randomUUID(), confidenceBand: input.confidence >= 0.8 ? "high" : input.confidence >= 0.5 ? "medium" : "low", state: "pending" };
  }
  private canonicalize(candidate: OrganizationCandidateInput, context: OrganizationContext): OrganizationCandidateInput {
    if (candidate.targetId) {
      if (!organizationTargetsForKind(context, candidate.kind).some((entry) => entry.id === candidate.targetId)) throw new InvalidOrganizationProposalError("unknown_or_wrong_kind_target");
      return candidate;
    }
    const name = candidate.suggestedName?.trim();
    if (!name) return candidate;
    const matches = organizationContextMatches(context, candidate.kind, name, candidate.entityType);
    if (matches.length > 1) throw new InvalidOrganizationProposalError("ambiguous_organization_name");
    if (matches.length === 1) return { kind: candidate.kind, targetId: matches[0]!.id, confidence: candidate.confidence, provenance: candidate.provenance };
    return { ...candidate, suggestedName: name };
  }
  private requireText(value: string, field: string): void { if (!value.trim()) throw new InvalidOrganizationProposalError(`${field} is required`); }
}

export function normalizeOrganizationName(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }

export function organizationTargetsForKind(context: OrganizationContext, kind: OrganizationCandidateKind): readonly { readonly id: string }[] {
  return { space: context.spaces, tag: context.tags, entity: context.entities }[kind];
}

export function organizationContextMatches(context: OrganizationContext, kind: OrganizationCandidateKind, name: string, entityType?: string): readonly { readonly id: string }[] {
  const normalizedName = normalizeOrganizationName(name);
  const matches = kind === "space"
    ? context.spaces.filter((entry) => normalizeOrganizationName(entry.name) === normalizedName || normalizeOrganizationName(entry.path) === normalizedName)
    : kind === "tag"
      ? context.tags.filter((entry) => normalizeOrganizationName(entry.name) === normalizedName)
      : context.entities.filter((entry) => normalizeOrganizationName(entry.name) === normalizedName && entry.type === entityType);
  return [...new Map(matches.map((entry) => [entry.id, entry])).values()];
}

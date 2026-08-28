import Database from "better-sqlite3";
import type { OrganizationProposal, OrganizationProposalCandidate, OrganizationProposalRepository, ProposalState, CandidateState } from "../../features/organization-proposals/organization-proposal.js";

type ProposalRow = { id: string; member_id: string; item_id: string; item_kind: "task" | "note"; idempotency_key: string; model_version: string; rules_version: string; state: ProposalState; created_at: string; updated_at: string };
type CandidateRow = { id: string; proposal_id: string; kind: OrganizationProposalCandidate["kind"]; confidence: number; confidence_band: OrganizationProposalCandidate["confidenceBand"]; target_id: string | null; suggested_name: string | null; entity_type: string | null; provenance_json: string; state: CandidateState };

export class SqliteOrganizationProposalRepository implements OrganizationProposalRepository {
  private readonly database: Database.Database;
  constructor(databasePath: string) { this.database = new Database(databasePath); }
  findByIdempotencyKey(memberId: string, key: string): OrganizationProposal | undefined { const row = this.database.prepare<[string, string], ProposalRow>("SELECT * FROM organization_proposals WHERE member_id = ? AND idempotency_key = ?").get(memberId, key); return row ? this.toProposal(row) : undefined; }
  findById(memberId: string, id: string): OrganizationProposal | undefined { const row = this.database.prepare<[string, string], ProposalRow>("SELECT * FROM organization_proposals WHERE member_id = ? AND id = ?").get(memberId, id); return row ? this.toProposal(row) : undefined; }
  listForItem(memberId: string, itemId: string, itemKind: "task" | "note"): readonly OrganizationProposal[] { return this.database.prepare<[string, string, string], ProposalRow>("SELECT * FROM organization_proposals WHERE member_id = ? AND item_id = ? AND item_kind = ? ORDER BY created_at DESC, id DESC").all(memberId, itemId, itemKind).map((row) => this.toProposal(row)); }
  create(proposal: OrganizationProposal): OrganizationProposal {
    const insert = this.database.transaction(() => {
      this.database.prepare("INSERT INTO organization_proposals (id, member_id, item_id, item_kind, idempotency_key, model_version, rules_version, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(proposal.id, proposal.memberId, proposal.itemId, proposal.itemKind, proposal.idempotencyKey, proposal.modelVersion, proposal.rulesVersion, proposal.state, proposal.createdAt, proposal.updatedAt);
      const statement = this.database.prepare("INSERT INTO organization_proposal_candidates (id, proposal_id, kind, confidence, confidence_band, target_id, suggested_name, entity_type, provenance_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const candidate of proposal.candidates) {
        statement.run(candidate.id, proposal.id, candidate.kind, candidate.confidence, candidate.confidenceBand, candidate.targetId ?? null, candidate.suggestedName ?? null, candidate.entityType ?? null, JSON.stringify(candidate.provenance), candidate.state);
        if (!candidate.targetId && (candidate.kind === "tag" || candidate.kind === "entity")) this.database.prepare("INSERT INTO suggested_organization_metadata (id, proposal_id, candidate_id, kind, name, entity_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(candidate.id + "-suggestion", proposal.id, candidate.id, candidate.kind, candidate.suggestedName, candidate.entityType ?? null, proposal.createdAt);
      }
    });
    insert(); return proposal;
  }
  updateDecision(memberId: string, proposalId: string, state: ProposalState, candidateIds: readonly string[]): OrganizationProposal | undefined {
    const existing = this.findById(memberId, proposalId); if (!existing) return undefined;
    const now = new Date().toISOString();
    const update = this.database.transaction(() => {
      this.database.prepare("UPDATE organization_proposals SET state = ?, updated_at = ? WHERE member_id = ? AND id = ?").run(state, now, memberId, proposalId);
      if (state === "accepted") {
        const ids = new Set(candidateIds.length ? candidateIds : existing.candidates.filter((candidate) => candidate.confidenceBand !== "low").map((candidate) => candidate.id));
        this.database.prepare("UPDATE organization_proposal_candidates SET state = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 'accepted' ELSE 'dismissed' END WHERE proposal_id = ?").run(JSON.stringify([...ids]), proposalId);
      } else this.database.prepare("UPDATE organization_proposal_candidates SET state = 'dismissed' WHERE proposal_id = ?").run(proposalId);
    });
    update(); return this.findById(memberId, proposalId);
  }
  deleteSuggested(proposalId: string): void { this.database.prepare("DELETE FROM suggested_organization_metadata WHERE proposal_id = ?").run(proposalId); }
  close(): void { this.database.close(); }
  private toProposal(row: ProposalRow): OrganizationProposal { return { id: row.id, memberId: row.member_id, itemId: row.item_id, itemKind: row.item_kind, idempotencyKey: row.idempotency_key, modelVersion: row.model_version, rulesVersion: row.rules_version, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, candidates: this.database.prepare<[string], CandidateRow>("SELECT * FROM organization_proposal_candidates WHERE proposal_id = ? ORDER BY id ASC").all(row.id).map((candidate) => ({ id: candidate.id, kind: candidate.kind, confidence: candidate.confidence, confidenceBand: candidate.confidence_band, ...(candidate.target_id === null ? {} : { targetId: candidate.target_id }), ...(candidate.suggested_name === null ? {} : { suggestedName: candidate.suggested_name }), ...(candidate.entity_type === null ? {} : { entityType: candidate.entity_type }), provenance: JSON.parse(candidate.provenance_json) as readonly string[], state: candidate.state })) }; }
}

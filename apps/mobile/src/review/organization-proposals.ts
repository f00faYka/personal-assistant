import { responseError } from "../http/request-error";

export type ProposalCandidateKind = "space" | "tag" | "entity";
export type ConfidenceBand = "high" | "medium" | "low";
export type CandidateState = "pending" | "accepted" | "dismissed";

export interface OrganizationProposalCandidate {
  readonly id: string;
  readonly kind: ProposalCandidateKind;
  readonly confidence: number;
  readonly confidenceBand: ConfidenceBand;
  readonly targetId?: string;
  readonly suggestedName?: string;
  readonly entityType?: string;
  readonly provenance: readonly string[];
  readonly state: CandidateState;
}

export interface OrganizationProposal {
  readonly id: string;
  readonly itemId: string;
  readonly itemKind: "task" | "note";
  readonly modelVersion: string;
  readonly rulesVersion: string;
  readonly state: "pending" | "accepted" | "dismissed";
  readonly candidates: readonly OrganizationProposalCandidate[];
}

export interface OrganizationProposalClient {
  list(itemId: string, itemKind: "task" | "note", memberId: string): Promise<readonly OrganizationProposal[]>;
  decide(proposalId: string, state: "accepted" | "dismissed", memberId: string, candidateIds?: readonly string[]): Promise<OrganizationProposal>;
}

export function createOrganizationProposalClient(apiBaseUrl: string): OrganizationProposalClient {
  return {
    async list(itemId, itemKind, memberId) {
      const body = await request<{ proposals: readonly OrganizationProposal[] }>(apiBaseUrl, `/items/${encodeURIComponent(itemId)}/organization-proposals?memberId=${encodeURIComponent(memberId)}&itemKind=${itemKind}`);
      return body.proposals;
    },
    async decide(proposalId, state, memberId, candidateIds) {
      const body = await request<{ proposal: OrganizationProposal }>(apiBaseUrl, `/organization-proposals/${encodeURIComponent(proposalId)}/${state === "accepted" ? "accept" : "dismiss"}`, { method: "POST", body: { memberId, ...(candidateIds === undefined ? {} : { candidateIds }) } });
      return body.proposal;
    },
  };
}

async function request<T>(base: string, path: string, options: { readonly method?: string; readonly body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    ...(options.method ? { method: options.method } : {}),
    ...(options.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }),
  });
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw responseError(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`, response.status);
  return body as T;
}


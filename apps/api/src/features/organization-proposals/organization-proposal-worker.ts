import type { MetadataService } from "../metadata/metadata.js";
import type { Outcome } from "../outcomes/outcome.js";
import type { SpaceService } from "../spaces/space.js";
import type { OrganizationCandidateInput, OrganizationContext, OrganizationItemKind, OrganizationProposal, OrganizationProposalService } from "./organization-proposal.js";

export type OrganizationProposalGenerationState = "pending" | "running" | "completed_empty" | "ready" | "failed";

export interface OrganizationProposalJob {
  readonly memberId: string;
  readonly itemId: string;
  readonly itemKind: OrganizationItemKind;
  readonly itemText: string;
  readonly transcriptionText: string;
  readonly status: "pending" | "processing" | "succeeded" | "failed";
  readonly error?: string;
  readonly retryable: boolean;
  readonly attemptCount: number;
}

export interface OrganizationProposalJobRepository {
  create(job: OrganizationProposalJob): OrganizationProposalJob;
  find(memberId: string, itemId: string): OrganizationProposalJob | undefined;
  recoverable(maxAttempts: number): readonly OrganizationProposalJob[];
  markProcessing(memberId: string, itemId: string): OrganizationProposalJob;
  complete(memberId: string, itemId: string): OrganizationProposalJob;
  fail(memberId: string, itemId: string, error: string, retryable: boolean): OrganizationProposalJob;
  retry(memberId: string, itemId: string): OrganizationProposalJob | undefined;
}

export interface OrganizationProposalGenerator {
  generate(input: { readonly item: { readonly id: string; readonly memberId: string; readonly kind: OrganizationItemKind; readonly text: string }; readonly transcriptionText: string; readonly context: OrganizationContext }): Promise<{ readonly modelVersion: string; readonly candidates: readonly OrganizationCandidateInput[] }>;
}

export type OrganizationProposalGenerationStatus =
  | { readonly state: "pending" | "running" }
  | { readonly state: "completed_empty" }
  | { readonly state: "ready"; readonly proposals: readonly OrganizationProposal[] }
  | { readonly state: "failed"; readonly retryable: boolean; readonly error: string };

export interface OrganizationProposalWorkerOptions {
  readonly repository: OrganizationProposalJobRepository;
  readonly proposalService: OrganizationProposalService;
  readonly provider: OrganizationProposalGenerator;
  readonly spaces: Pick<SpaceService, "list"> & Partial<Pick<SpaceService, "read">>;
  readonly metadata: Pick<MetadataService, "listTags" | "listEntities">;
  readonly maxAttempts: number;
  readonly onError?: (error: unknown, itemId: string) => void;
}

export class OrganizationProposalWorker {
  private readonly scheduled = new Set<string>();
  private queue = Promise.resolve();
  private started = false;

  constructor(private readonly options: OrganizationProposalWorkerOptions) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const job of this.options.repository.recoverable(this.options.maxAttempts)) this.schedule(job);
  }

  outcomeCreated(outcome: Outcome, transcriptionText: string): void {
    if (!this.started) return;
    const job = this.options.repository.create({
      memberId: outcome.memberId,
      itemId: outcome.id,
      itemKind: outcome.kind,
      itemText: outcome.kind === "task" ? outcome.title : outcome.content,
      transcriptionText,
      status: "pending",
      retryable: true,
      attemptCount: 0,
    });
    this.schedule(job);
  }

  retry(memberId: string, itemId: string): OrganizationProposalGenerationStatus {
    const job = this.options.repository.find(memberId, itemId);
    if (!job || job.status !== "failed" || !job.retryable) return this.status(memberId, itemId, job?.itemKind ?? "note");
    const pending = this.options.repository.retry(memberId, itemId);
    if (pending) this.schedule(pending);
    return this.status(memberId, itemId, pending?.itemKind ?? job.itemKind);
  }

  status(memberId: string, itemId: string, itemKind: OrganizationItemKind): OrganizationProposalGenerationStatus {
    const job = this.options.repository.find(memberId, itemId);
    if (!job) return { state: "pending" };
    if (job.itemKind !== itemKind) return { state: "pending" };
    if (job.status === "pending") return { state: "pending" };
    if (job.status === "processing") return { state: "running" };
    if (job.status === "failed") return { state: "failed", retryable: job.retryable, error: job.error ?? "Organization proposal generation failed" };
    const proposals = this.options.proposalService.list(memberId, itemId, itemKind);
    return proposals.length === 0 ? { state: "completed_empty" } : { state: "ready", proposals };
  }

  async drain(): Promise<void> { await this.queue; }

  async stop(): Promise<void> { this.started = false; await this.queue; }

  private schedule(job: OrganizationProposalJob): void {
    const key = `${job.memberId}:${job.itemId}`;
    if (!this.started || job.status === "succeeded" || job.attemptCount >= this.options.maxAttempts || this.scheduled.has(key)) return;
    this.scheduled.add(key);
    this.queue = this.queue.then(async () => {
      try { await this.process(job); }
      catch (error) { this.options.onError?.(error, job.itemId); }
      finally { this.scheduled.delete(key); }
    });
  }

  private async process(job: OrganizationProposalJob): Promise<void> {
    const processing = this.options.repository.markProcessing(job.memberId, job.itemId);
    try {
      const context = this.context(job.memberId);
      const result = await this.options.provider.generate({ item: { id: job.itemId, memberId: job.memberId, kind: job.itemKind, text: job.itemText }, transcriptionText: job.transcriptionText, context });
      if (result.candidates.length > 0) this.options.proposalService.create({
        memberId: job.memberId,
        itemId: job.itemId,
        itemKind: job.itemKind,
        idempotencyKey: `capture-organization:${job.itemId}:v1`,
        modelVersion: result.modelVersion,
        rulesVersion: "organization-proposals.v1",
        context,
        candidates: result.candidates,
      });
      this.options.repository.complete(job.memberId, job.itemId);
    } catch (error) {
      this.options.repository.fail(job.memberId, job.itemId, "Organization proposal generation failed; retry later.", processing.attemptCount < this.options.maxAttempts);
      throw error;
    }
  }

  private context(memberId: string): OrganizationContext {
    const spaces = this.options.spaces.list(memberId).filter((space) => !space.archivedAt);
    const pathFor = (spaceId: string, seen = new Set<string>()): string => {
      const space = spaces.find((value) => value.id === spaceId);
      if (!space || seen.has(space.id)) return "";
      seen.add(space.id);
      const parent = space.parentId ? pathFor(space.parentId, seen) : "";
      return parent ? `${parent}/${space.name}` : space.name;
    };
    return {
      spaces: spaces.map((space) => ({
        id: space.id,
        name: space.name,
        path: pathFor(space.id),
        examples: this.options.spaces.read?.(memberId, space.id, true).items
          .map((item) => (item.title ?? item.content ?? "").slice(0, 200))
          .filter(Boolean)
          .slice(0, 3) ?? [],
      })),
      tags: this.options.metadata.listTags(memberId).map(({ id, name }) => ({ id, name })),
      entities: this.options.metadata.listEntities(memberId).map(({ id, name, type }) => ({ id, name, type })),
    };
  }
}

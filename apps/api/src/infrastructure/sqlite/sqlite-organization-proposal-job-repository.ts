import Database from "better-sqlite3";
import type { OrganizationProposalJob, OrganizationProposalJobRepository } from "../../features/organization-proposals/organization-proposal-worker.js";

interface JobRow {
  member_id: string;
  item_id: string;
  item_kind: OrganizationProposalJob["itemKind"];
  item_text: string;
  transcription_text: string;
  status: OrganizationProposalJob["status"];
  error: string | null;
  retryable: number;
  attempt_count: number;
}

export class SqliteOrganizationProposalJobRepository implements OrganizationProposalJobRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) { this.database = new Database(databasePath); }

  create(job: OrganizationProposalJob): OrganizationProposalJob {
    const now = new Date().toISOString();
    this.database.prepare(`INSERT OR IGNORE INTO organization_proposal_jobs
      (member_id, item_id, item_kind, item_text, transcription_text, status, error, retryable, attempt_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NULL, 1, 0, ?, ?)`).run(job.memberId, job.itemId, job.itemKind, job.itemText, job.transcriptionText, now, now);
    return this.require(job.memberId, job.itemId);
  }

  find(memberId: string, itemId: string): OrganizationProposalJob | undefined {
    const row = this.database.prepare<[string, string], JobRow>("SELECT * FROM organization_proposal_jobs WHERE member_id = ? AND item_id = ?").get(memberId, itemId);
    return row ? toJob(row) : undefined;
  }

  recoverable(maxAttempts: number): readonly OrganizationProposalJob[] {
    return this.database.prepare<[number], JobRow>("SELECT * FROM organization_proposal_jobs WHERE (status IN ('pending', 'processing') OR (status = 'failed' AND retryable = 1)) AND attempt_count < ? ORDER BY created_at, item_id").all(maxAttempts).map(toJob);
  }

  markProcessing(memberId: string, itemId: string): OrganizationProposalJob {
    this.database.prepare("UPDATE organization_proposal_jobs SET status = 'processing', error = NULL, retryable = 1, attempt_count = attempt_count + 1, updated_at = ? WHERE member_id = ? AND item_id = ?").run(new Date().toISOString(), memberId, itemId);
    return this.require(memberId, itemId);
  }

  complete(memberId: string, itemId: string): OrganizationProposalJob {
    this.database.prepare("UPDATE organization_proposal_jobs SET status = 'succeeded', error = NULL, retryable = 0, updated_at = ? WHERE member_id = ? AND item_id = ?").run(new Date().toISOString(), memberId, itemId);
    return this.require(memberId, itemId);
  }

  fail(memberId: string, itemId: string, error: string, retryable: boolean): OrganizationProposalJob {
    this.database.prepare("UPDATE organization_proposal_jobs SET status = 'failed', error = ?, retryable = ?, updated_at = ? WHERE member_id = ? AND item_id = ?").run(error, retryable ? 1 : 0, new Date().toISOString(), memberId, itemId);
    return this.require(memberId, itemId);
  }

  retry(memberId: string, itemId: string): OrganizationProposalJob | undefined {
    this.database.prepare("UPDATE organization_proposal_jobs SET status = 'pending', error = NULL, updated_at = ? WHERE member_id = ? AND item_id = ? AND status = 'failed' AND retryable = 1").run(new Date().toISOString(), memberId, itemId);
    return this.find(memberId, itemId);
  }

  close(): void { this.database.close(); }

  private require(memberId: string, itemId: string): OrganizationProposalJob {
    const job = this.find(memberId, itemId);
    if (!job) throw new Error(`Organization proposal job not found: ${itemId}`);
    return job;
  }
}

function toJob(row: JobRow): OrganizationProposalJob {
  return { memberId: row.member_id, itemId: row.item_id, itemKind: row.item_kind, itemText: row.item_text, transcriptionText: row.transcription_text, status: row.status, ...(row.error === null ? {} : { error: row.error }), retryable: row.retryable === 1, attemptCount: row.attempt_count };
}

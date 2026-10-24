import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MetadataService } from "../metadata/metadata.js";
import { SpaceService } from "../spaces/space.js";
import { buildApi } from "../../http/build-api.js";
import { foundationMigrations } from "../../infrastructure/sqlite/foundation-migrations.js";
import { migrateDatabase } from "../../infrastructure/sqlite/migrate.js";
import { SqliteMetadataRepository } from "../../infrastructure/sqlite/sqlite-metadata-repository.js";
import { SqliteOrganizationProposalRepository } from "../../infrastructure/sqlite/sqlite-organization-proposal-repository.js";
import { SqliteSpaceRepository } from "../../infrastructure/sqlite/sqlite-space-repository.js";
import { OrganizationProposalService } from "./organization-proposal.js";

describe("organization proposal production route", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  test("applies an existing high-confidence Space and accepts a suggested Tag", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-organization-route-")); directories.push(directory);
    const databasePath = join(directory, "api.sqlite"); migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.prepare("INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, content, review_state, created_at) VALUES (?, 'note', ?, ?, ?, ?, ?, 'none', ?)").run("note-1", "member-1", "interpretation-1", "capture-1", "source-1", "remember", "2026-01-01T00:00:00.000Z"); database.close();
    const spaceRepository = new SqliteSpaceRepository(databasePath); const metadataRepository = new SqliteMetadataRepository(databasePath); const proposalRepository = new SqliteOrganizationProposalRepository(databasePath);
    const spaceService = new SpaceService(spaceRepository); const metadataService = new MetadataService(metadataRepository); const space = spaceService.create("member-1", "Home");
    const application = buildApi({ organizationProposalService: new OrganizationProposalService(proposalRepository, { spaceService, metadataService }) });
    const created = await application.inject({ method: "POST", url: "/organization-proposals", payload: { memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "capture-1:v1", modelVersion: "qwen", rulesVersion: "organization.v1", context: { spaces: [{ id: space.id, name: space.name, path: "Home", description: "home", examples: ["keys"] }], tags: [], entities: [] }, candidates: [{ kind: "space", targetId: space.id, confidence: 0.9, provenance: ["rules"] }, { kind: "tag", suggestedName: "errands", confidence: 0.6, provenance: ["model"] }] } });
    expect(created.statusCode).toBe(201); const proposalId = created.json().proposal.id as string;
    const duplicate = await application.inject({ method: "POST", url: "/organization-proposals", payload: { memberId: "member-1", itemId: "note-1", itemKind: "note", idempotencyKey: "capture-1:v1", modelVersion: "qwen", rulesVersion: "organization.v1", context: { spaces: [{ id: space.id, name: space.name, path: "Home", description: "home", examples: ["keys"] }], tags: [], entities: [] }, candidates: [{ kind: "space", targetId: space.id, confidence: 0.9, provenance: ["rules"] }, { kind: "tag", suggestedName: "errands", confidence: 0.6, provenance: ["model"] }] } });
    expect(duplicate.json().proposal.id).toBe(proposalId);
    expect(spaceRepository.listItems("member-1", [space.id])).toEqual([{ itemId: "note-1", itemKind: "note", spaceId: space.id, content: "remember" }]);
    const accepted = await application.inject({ method: "POST", url: `/organization-proposals/${proposalId}/accept`, payload: { memberId: "member-1" } });
    expect(accepted.statusCode).toBe(200); expect(metadataService.listTags("member-1")).toHaveLength(1); expect(metadataService.listTags("member-1")[0]?.name).toBe("errands");
    expect(metadataService.listLinks("note-1", "note", "member-1").tags[0]?.name).toBe("errands");
    await application.close(); proposalRepository.close(); metadataRepository.close(); spaceRepository.close();
  });
});

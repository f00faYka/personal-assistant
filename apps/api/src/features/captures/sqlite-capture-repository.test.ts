import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { CaptureService, blobIdentifier } from "./capture.js";
import { FileSystemBlobStorage } from "../../infrastructure/blob-storage/filesystem-blob-storage.js";
import { foundationMigrations } from "../../infrastructure/sqlite/foundation-migrations.js";
import { migrateDatabase } from "../../infrastructure/sqlite/migrate.js";
import { SqliteCaptureRepository } from "../../infrastructure/sqlite/sqlite-capture-repository.js";

describe("SqliteCaptureRepository", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("persists capture metadata and original audio across repository instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-captures-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    const blobRoot = join(directory, "blobs");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const firstRepository = new SqliteCaptureRepository(databasePath);
    const service = new CaptureService(firstRepository, new FileSystemBlobStorage(blobRoot));

    const capture = await service.submit({
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([4, 5, 6]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
    firstRepository.close();

    const secondRepository = new SqliteCaptureRepository(databasePath);
    expect(secondRepository.findById(capture.id)).toEqual(capture);
    expect(secondRepository.findById(capture.id)?.timeZone).toBe("America/Los_Angeles");
    secondRepository.close();
    await expect(readFile(join(blobRoot, blobIdentifier(capture)))).resolves.toEqual(
      Buffer.from([4, 5, 6]),
    );
  });

  test("coalesces concurrent identical submissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-concurrent-captures-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    const blobRoot = join(directory, "blobs");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const firstRepository = new SqliteCaptureRepository(databasePath);
    const secondRepository = new SqliteCaptureRepository(databasePath);
    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([7, 8, 9]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };

    const [first, second] = await Promise.all([
      new CaptureService(firstRepository, new FileSystemBlobStorage(blobRoot)).submit(submission),
      new CaptureService(secondRepository, new FileSystemBlobStorage(blobRoot)).submit(submission),
    ]);

    expect(second).toEqual(first);
    firstRepository.close();
    secondRepository.close();
  });
});

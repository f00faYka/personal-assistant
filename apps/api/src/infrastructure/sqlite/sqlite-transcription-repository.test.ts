import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteTranscriptionRepository } from "./sqlite-transcription-repository.js";

describe("SqliteTranscriptionRepository", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  test("persists processing, success, and retry state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteTranscriptionRepository(databasePath);

    repository.create({
      id: "transcription-1",
      captureId: "capture-1",
      sourceId: "source-1",
      contentType: "audio/m4a",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(repository.markProcessing("capture-1")).toMatchObject({
      status: "processing",
      attemptCount: 1,
    });
    expect(repository.complete("capture-1", {
      text: "buy milk",
      provider: "whisper",
      model: "small",
    })).toMatchObject({ status: "succeeded", text: "buy milk" });

    repository.close();
    const reopened = new SqliteTranscriptionRepository(databasePath);
    expect(reopened.findByCaptureId("capture-1")).toMatchObject({
      status: "succeeded",
      provider: "whisper",
      attemptCount: 1,
    });
    reopened.close();
  });

  test("identifies an interrupted final attempt as exhausted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-recovery-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteTranscriptionRepository(databasePath);
    repository.create({
      id: "transcription-1",
      captureId: "capture-1",
      sourceId: "source-1",
      contentType: "audio/m4a",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-08-15T10:00:00.000Z",
      updatedAt: "2026-08-15T10:00:00.000Z",
    });
    expect(repository.markProcessing("capture-1").attemptCount).toBe(1);
    repository.close();

    const restarted = new SqliteTranscriptionRepository(databasePath);
    expect(restarted.findRecoverable(1)).toEqual([]);
    expect(restarted.findExhaustedProcessing(1)).toEqual([
      expect.objectContaining({ captureId: "capture-1", status: "processing", attemptCount: 1 }),
    ]);
    restarted.close();
  });
});

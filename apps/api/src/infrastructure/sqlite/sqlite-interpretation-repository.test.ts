import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  SUPPORTED_INTERPRETATION_CATALOG_VERSION,
  type Interpretation,
} from "../../features/interpretations/interpretation.js";
import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteInterpretationRepository } from "./sqlite-interpretation-repository.js";

describe("SqliteInterpretationRepository", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  test("persists interpretation evidence and keeps the transcription link unique", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteInterpretationRepository(databasePath);
    const interpretation: Interpretation = {
      id: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      transcriptionId: "transcription-1",
      catalogVersion: SUPPORTED_INTERPRETATION_CATALOG_VERSION,
      model: "qwen-test",
      rawOutputJson: '{"action":"create_task","title":"Buy milk"}',
      classification: "clear_supported",
      action: { kind: "create_task", title: "Buy milk" },
      createdAt: "2026-08-14T10:00:00.000Z",
    };

    expect(repository.create(interpretation)).toEqual(interpretation);
    expect(repository.create({ ...interpretation, id: "interpretation-2" })).toEqual(interpretation);
    repository.close();

    const reopened = new SqliteInterpretationRepository(databasePath);
    expect(reopened.findByTranscriptionId("transcription-1")).toEqual(interpretation);
    reopened.close();
  });
});

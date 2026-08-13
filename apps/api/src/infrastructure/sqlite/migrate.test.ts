import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { MigrationError, migrateDatabase, type Migration } from "./migrate.js";

describe("SQLite migrations", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  test("creates a fresh database by applying migrations in version order", async () => {
    const databasePath = await createDatabasePath();
    const migrations: readonly Migration[] = [
      {
        version: 2,
        name: "insert readiness record",
        sql: "INSERT INTO readiness (status) VALUES ('ready')",
      },
      {
        version: 1,
        name: "create readiness table",
        sql: "CREATE TABLE readiness (status TEXT NOT NULL)",
      },
    ];

    const result = migrateDatabase({ databasePath, migrations });

    expect(result.appliedVersions).toEqual([1, 2]);
  });

  test("does not reapply migrations on repeat startup", async () => {
    const databasePath = await createDatabasePath();
    const migrations: readonly Migration[] = [
      {
        version: 1,
        name: "create readiness table",
        sql: "CREATE TABLE readiness (status TEXT NOT NULL)",
      },
    ];

    migrateDatabase({ databasePath, migrations });
    const repeatResult = migrateDatabase({ databasePath, migrations });

    expect(repeatResult.appliedVersions).toEqual([]);
  });

  test("fails deterministically and rolls back an invalid migration", async () => {
    const databasePath = await createDatabasePath();
    const invalidMigration: Migration = {
      version: 1,
      name: "broken migration",
      sql: "CREATE TABLE readiness (status TEXT NOT NULL); THIS IS NOT VALID SQL",
    };

    expect(() =>
      migrateDatabase({ databasePath, migrations: [invalidMigration] }),
    ).toThrowError(MigrationError);
    expect(() =>
      migrateDatabase({ databasePath, migrations: [invalidMigration] }),
    ).toThrowError("Migration 1 (broken migration) failed");

    const correctedResult = migrateDatabase({
      databasePath,
      migrations: [
        {
          version: 1,
          name: "corrected migration",
          sql: "CREATE TABLE readiness (status TEXT NOT NULL)",
        },
      ],
    });
    expect(correctedResult.appliedVersions).toEqual([1]);
  });

  async function createDatabasePath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-migration-"));
    temporaryDirectories.push(directory);
    return join(directory, "api.sqlite");
  }
});

import Database from "better-sqlite3";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationResult {
  readonly appliedVersions: readonly number[];
}

export interface MigrateDatabaseOptions {
  readonly databasePath: string;
  readonly migrations: readonly Migration[];
}

export class MigrationError extends Error {
  constructor(migration: Migration, cause: unknown) {
    super(`Migration ${migration.version} (${migration.name}) failed`, { cause });
    this.name = "MigrationError";
  }
}

export function migrateDatabase({
  databasePath,
  migrations,
}: MigrateDatabaseOptions): MigrationResult {
  const database = new Database(databasePath);

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const alreadyApplied = new Set(
      database
        .prepare<[], { version: number }>("SELECT version FROM schema_migrations")
        .all()
        .map(({ version }) => version),
    );
    const appliedVersions: number[] = [];
    const applyMigration = database.transaction((migration: Migration) => {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      appliedVersions.push(migration.version);
    });

    for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
      if (alreadyApplied.has(migration.version)) {
        continue;
      }
      try {
        applyMigration(migration);
      } catch (cause) {
        throw new MigrationError(migration, cause);
      }
    }

    return { appliedVersions };
  } finally {
    database.close();
  }
}

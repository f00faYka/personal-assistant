import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ApiConfiguration } from "./configuration.js";
import { migrateDatabase } from "./infrastructure/sqlite/migrate.js";
import { foundationMigrations } from "./infrastructure/sqlite/foundation-migrations.js";

export async function prepareRuntime(
  configuration: Pick<ApiConfiguration, "databasePath" | "blobRoot">,
): Promise<void> {
  await Promise.all([
    mkdir(dirname(configuration.databasePath), { recursive: true }),
    mkdir(configuration.blobRoot, { recursive: true }),
  ]);
  migrateDatabase({
    databasePath: configuration.databasePath,
    migrations: foundationMigrations,
  });
}

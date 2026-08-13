import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import * as z from "zod";

const configurationSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  API_DATABASE_PATH: z.string().min(1).default("local-data/api.sqlite"),
  API_BLOB_ROOT: z.string().min(1).default("local-data/blobs"),
});

export interface ApiConfiguration {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly blobRoot: string;
}

export function loadLocalEnvironment(filePath = resolve(repositoryRoot, ".env")): void {
  try {
    loadEnvFile(filePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function loadConfiguration(environment: NodeJS.ProcessEnv): ApiConfiguration {
  const result = configurationSchema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError(z.prettifyError(result.error));
  }

  return {
    host: result.data.API_HOST,
    port: result.data.API_PORT,
    databasePath: resolve(repositoryRoot, result.data.API_DATABASE_PATH),
    blobRoot: resolve(repositoryRoot, result.data.API_BLOB_ROOT),
  };
}

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export class ConfigurationError extends Error {
  constructor(details: string) {
    super(`Invalid API configuration:\n${details}`);
    this.name = "ConfigurationError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

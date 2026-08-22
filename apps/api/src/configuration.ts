import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import * as z from "zod";

const configurationSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  API_DATABASE_PATH: z.string().min(1).default("local-data/api.sqlite"),
  API_BLOB_ROOT: z.string().min(1).default("local-data/blobs"),
  WHISPER_ENDPOINT: z.url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "WHISPER_ENDPOINT must use HTTP or HTTPS",
  ).default("http://127.0.0.1:8080/inference"),
  WHISPER_MODEL: z.string().min(1).default("ggml-base.en"),
  WHISPER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  TRANSCRIPTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  OLLAMA_ENDPOINT: z.url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "OLLAMA_ENDPOINT must use HTTP or HTTPS",
  ).default("http://127.0.0.1:11434/api/chat"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3.5:4b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(120_000),
  INTERPRETATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
});

export interface ApiConfiguration {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly blobRoot: string;
  readonly whisperEndpoint: string;
  readonly whisperModel: string;
  readonly whisperTimeoutMilliseconds: number;
  readonly transcriptionMaxAttempts: number;
  readonly ollamaEndpoint: string;
  readonly ollamaModel: string;
  readonly ollamaTimeoutMilliseconds: number;
  readonly interpretationMaxAttempts: number;
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
    whisperEndpoint: result.data.WHISPER_ENDPOINT,
    whisperModel: result.data.WHISPER_MODEL,
    whisperTimeoutMilliseconds: result.data.WHISPER_TIMEOUT_MS,
    transcriptionMaxAttempts: result.data.TRANSCRIPTION_MAX_ATTEMPTS,
    ollamaEndpoint: result.data.OLLAMA_ENDPOINT,
    ollamaModel: result.data.OLLAMA_MODEL,
    ollamaTimeoutMilliseconds: result.data.OLLAMA_TIMEOUT_MS,
    interpretationMaxAttempts: result.data.INTERPRETATION_MAX_ATTEMPTS,
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

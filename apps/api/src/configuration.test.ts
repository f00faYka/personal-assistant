import { describe, expect, test } from "vitest";

import { ConfigurationError, loadConfiguration } from "./configuration.js";

describe("API configuration", () => {
  test("provides bounded local Whisper defaults", () => {
    expect(loadConfiguration({})).toMatchObject({
      whisperEndpoint: "http://127.0.0.1:8080/inference",
      whisperModel: "ggml-small",
      whisperTimeoutMilliseconds: 120_000,
      transcriptionMaxAttempts: 3,
      ollamaEndpoint: "http://127.0.0.1:11434/api/chat",
      ollamaModel: "qwen3.5:4b",
      ollamaTimeoutMilliseconds: 120_000,
      interpretationMaxAttempts: 3,
    });
  });

  test("loads explicit local Whisper settings", () => {
    expect(loadConfiguration({
      WHISPER_ENDPOINT: "http://127.0.0.1:9090/inference",
      WHISPER_MODEL: "ggml-small",
      WHISPER_TIMEOUT_MS: "45000",
      TRANSCRIPTION_MAX_ATTEMPTS: "2",
      OLLAMA_ENDPOINT: "http://127.0.0.1:22468/api/chat",
      OLLAMA_MODEL: "qwen3.5:9b",
      OLLAMA_TIMEOUT_MS: "60000",
      INTERPRETATION_MAX_ATTEMPTS: "4",
    })).toMatchObject({
      whisperEndpoint: "http://127.0.0.1:9090/inference",
      whisperModel: "ggml-small",
      whisperTimeoutMilliseconds: 45_000,
      transcriptionMaxAttempts: 2,
      ollamaEndpoint: "http://127.0.0.1:22468/api/chat",
      ollamaModel: "qwen3.5:9b",
      ollamaTimeoutMilliseconds: 60_000,
      interpretationMaxAttempts: 4,
    });
  });

  test("rejects unbounded or non-HTTP Whisper settings", () => {
    expect(() => loadConfiguration({ WHISPER_ENDPOINT: "file:///tmp/model" })).toThrow(ConfigurationError);
    expect(() => loadConfiguration({ TRANSCRIPTION_MAX_ATTEMPTS: "0" })).toThrow(ConfigurationError);
    expect(() => loadConfiguration({ OLLAMA_ENDPOINT: "file:///tmp/model" })).toThrow(ConfigurationError);
    expect(() => loadConfiguration({ INTERPRETATION_MAX_ATTEMPTS: "11" })).toThrow(ConfigurationError);
  });
});

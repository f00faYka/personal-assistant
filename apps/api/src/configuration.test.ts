import { describe, expect, test } from "vitest";

import { ConfigurationError, loadConfiguration } from "./configuration.js";

describe("API configuration", () => {
  test("provides bounded local Whisper defaults", () => {
    expect(loadConfiguration({})).toMatchObject({
      whisperEndpoint: "http://127.0.0.1:8080/inference",
      whisperModel: "ggml-base.en",
      whisperTimeoutMilliseconds: 120_000,
      transcriptionMaxAttempts: 3,
    });
  });

  test("loads explicit local Whisper settings", () => {
    expect(loadConfiguration({
      WHISPER_ENDPOINT: "http://127.0.0.1:9090/inference",
      WHISPER_MODEL: "ggml-small",
      WHISPER_TIMEOUT_MS: "45000",
      TRANSCRIPTION_MAX_ATTEMPTS: "2",
    })).toMatchObject({
      whisperEndpoint: "http://127.0.0.1:9090/inference",
      whisperModel: "ggml-small",
      whisperTimeoutMilliseconds: 45_000,
      transcriptionMaxAttempts: 2,
    });
  });

  test("rejects unbounded or non-HTTP Whisper settings", () => {
    expect(() => loadConfiguration({ WHISPER_ENDPOINT: "file:///tmp/model" })).toThrow(ConfigurationError);
    expect(() => loadConfiguration({ TRANSCRIPTION_MAX_ATTEMPTS: "0" })).toThrow(ConfigurationError);
  });
});

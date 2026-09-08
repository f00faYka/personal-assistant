import { EventEmitter } from "node:events";

import { describe, expect, test, vi } from "vitest";

import {
  ConfigurationError,
  SupervisedDevelopment,
  loadSupervisedConfiguration,
} from "./supervised-dev.mjs";

const validEnvironment = {
  API_HOST: "127.0.0.1",
  API_PORT: "3000",
  OLLAMA_ENDPOINT: "http://127.0.0.1:11434/api/chat",
  OLLAMA_HEALTH_ENDPOINT: "http://127.0.0.1:11434/api/tags",
  OLLAMA_MODEL: "reviewed-model",
  OLLAMA_BINARY_PATH: "/tools/ollama",
  WHISPER_ENDPOINT: "http://127.0.0.1:8080/inference",
  WHISPER_HEALTH_ENDPOINT: "http://127.0.0.1:8080/health",
  WHISPER_BINARY_PATH: "/tools/whisper-server",
  WHISPER_MODEL_PATH: "/models/reviewed.bin",
  WHISPER_MODEL: "reviewed-whisper-model",
  EXPO_PUBLIC_API_BASE_URL: "http://127.0.0.1:3000",
  SUPERVISOR_READINESS_TIMEOUT_MS: "100",
  SUPERVISOR_POLL_INTERVAL_MS: "1",
};

function child() {
  const process = new EventEmitter();
  process.kill = vi.fn(() => process.emit("exit", 0, "SIGTERM"));
  return process;
}

describe("supervised development configuration", () => {
  test("requires configurable runtime endpoints, model, and asset paths", () => {
    expect(loadSupervisedConfiguration(validEnvironment)).toMatchObject({
      ollamaModel: "reviewed-model",
      whisperBinaryPath: "/tools/whisper-server",
      whisperModelPath: "/models/reviewed.bin",
    });

    expect(() => loadSupervisedConfiguration({})).toThrow(ConfigurationError);
    expect(() => loadSupervisedConfiguration({ ...validEnvironment, OLLAMA_MODEL: "" })).toThrow(/OLLAMA_MODEL/);
    expect(() => loadSupervisedConfiguration({ ...validEnvironment, WHISPER_ENDPOINT: "file:///tmp/inference" })).toThrow(/WHISPER_ENDPOINT/);
  });
});

describe("SupervisedDevelopment", () => {
  test("reuses ready services and does not spawn duplicates", async () => {
    const spawn = vi.fn(() => child());
    const fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => url.endsWith("tags") ? { models: [{ name: "reviewed-model" }] } : {},
    }));
    const exists = vi.fn(() => true);
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists });

    await routine.start();
    await routine.start();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(1, "npm", ["run", "dev", "--workspace", "@personal-assistant/api"], expect.any(Object));
    expect(spawn).toHaveBeenNthCalledWith(2, "npm", ["run", "start", "--workspace", "@personal-assistant/mobile"], expect.any(Object));
  });

  test("starts missing services only after validating Whisper assets and waits for readiness", async () => {
    const whisper = child();
    const ollama = child();
    const api = child();
    const mobile = child();
    const spawn = vi.fn()
      .mockReturnValueOnce(ollama)
      .mockReturnValueOnce(whisper)
      .mockReturnValueOnce(api)
      .mockReturnValueOnce(mobile);
    const calls = [];
    const fetch = vi.fn(async (url) => {
      calls.push(url);
      if (url.endsWith("tags")) {
        if (calls.filter((value) => value.endsWith("tags")).length === 1) throw new Error("not ready");
        return { ok: true, json: async () => ({ models: [{ name: "reviewed-model" }] }) };
      }
      if (url.endsWith("health")) {
        if (calls.filter((value) => value.endsWith("health")).length === 1) throw new Error("not ready");
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists: () => true });

    await routine.start();

    expect(spawn).toHaveBeenCalledTimes(4);
    expect(spawn.mock.calls[0][0]).toBe("/tools/ollama");
    expect(spawn.mock.calls[1][0]).toBe("/tools/whisper-server");
    expect(spawn.mock.calls[1][1]).toContain("/models/reviewed.bin");
    expect(calls).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:8080/health",
      "http://127.0.0.1:8080/health",
    ]);
  });

  test("reports missing assets and startup failures without starting API or Expo", async () => {
    const spawn = vi.fn(() => child());
    const fetch = vi.fn(async (url) => url.endsWith("tags")
      ? { ok: true, json: async () => ({ models: [{ name: "reviewed-model" }] }) }
      : (() => { throw new Error("offline"); })());
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists: () => false });

    await expect(routine.start()).rejects.toThrow(/WHISPER_BINARY_PATH.*WHISPER_MODEL_PATH/);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("reports a missing configured Ollama model without starting a duplicate daemon", async () => {
    const spawn = vi.fn(() => child());
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: "another-model" }] }) }));
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists: () => true });

    await expect(routine.start()).rejects.toThrow(/Configured Ollama model is missing: reviewed-model/);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("reports an Ollama startup failure without starting API or Expo", async () => {
    const spawn = vi.fn(() => { throw new Error("spawn failed"); });
    const fetch = vi.fn(async () => { throw new Error("offline"); });
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists: () => true });

    await expect(routine.start()).rejects.toThrow("spawn failed");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("cleans up only processes started by the routine", async () => {
    const ollama = child();
    const whisper = child();
    const api = child();
    const mobile = child();
    const spawn = vi.fn().mockReturnValueOnce(ollama).mockReturnValueOnce(whisper).mockReturnValueOnce(api).mockReturnValueOnce(mobile);
    const attempts = new Map();
    const fetch = vi.fn(async (url) => {
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      if (attempt === 1) throw new Error("offline");
      return url.endsWith("tags")
        ? { ok: true, json: async () => ({ models: [{ name: "reviewed-model" }] }) }
        : { ok: true, json: async () => ({}) };
    });
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, exists: () => true });

    await routine.start();
    await routine.stop();

    expect(ollama.kill).toHaveBeenCalledWith("SIGTERM");
    expect(whisper.kill).toHaveBeenCalledWith("SIGTERM");
    expect(api.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mobile.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

import { EventEmitter } from "node:events";

import { describe, expect, test, vi } from "vitest";

import {
  ConfigurationError,
  HerdrRuntime,
  SupervisedDevelopment,
  isHerdrEnvironment,
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

  test("detects a Herdr-launched command from its environment", () => {
    expect(isHerdrEnvironment({ HERDR_ENV: "1", HERDR_WORKSPACE_ID: "w3" })).toBe(true);
    expect(isHerdrEnvironment({ HERDR_ENV: "1" })).toBe(false);
    expect(isHerdrEnvironment({})).toBe(false);
  });
});

describe("HerdrRuntime", () => {
  test("uses the run tab, creates separate labelled panes, and stops only owned panes", () => {
    const commands = [];
    const panes = [];
    let nextPane = 10;
    const runCommand = vi.fn((arguments_) => {
      commands.push(arguments_);
      if (arguments_[0] === "tab" && arguments_[1] === "list") return { tabs: [{ tab_id: "w3:t2", label: "run", pane_id: "w3:p4" }] };
      if (arguments_[0] === "pane" && arguments_[1] === "list") return { panes: [...panes] };
      if (arguments_[0] === "pane" && arguments_[1] === "split") {
        const pane = { pane_id: `w3:p${nextPane++}` };
        panes.push({ ...pane, tab_id: "w3:t2" });
        return { pane };
      }
      return {};
    });
    const runtime = new HerdrRuntime({
      environment: { HERDR_WORKSPACE_ID: "w3" },
      runCommand,
      cwd: "/repo",
    });

    expect(runtime.startProcess("npm", ["run", "dev"], "API", { API_PORT: "3000" })).toEqual({ paneId: "w3:p10", owned: true });
    expect(runtime.startProcess("npm", ["run", "start"], "Expo", { EXPO_PUBLIC_API_BASE_URL: "http://phone.test" })).toEqual({ paneId: "w3:p11", owned: true });
    runtime.stop();

    expect(commands).toContainEqual(["pane", "run", "w3:p10", "'npm' 'run' 'dev'"]);
    expect(commands).toContainEqual(["pane", "rename", "w3:p10", "personal-assistant API :3000"]);
    expect(commands).toContainEqual(["pane", "send-text", "w3:p11", "\u0003"]);
    expect(commands).toContainEqual(["pane", "send-text", "w3:p10", "\u0003"]);
  });

  test("reuses an existing labelled run-tab pane", () => {
    const runCommand = vi.fn((arguments_) => {
      if (arguments_[0] === "tab") return { tabs: [{ tab_id: "w3:t2", label: "run" }] };
      if (arguments_[0] === "pane" && arguments_[1] === "list") return { panes: [{ pane_id: "w3:p5", tab_id: "w3:t2", label: "personal-assistant API :3000" }] };
      if (arguments_[0] === "pane" && arguments_[1] === "process-info") return { process_info: { foreground_processes: [{ cmdline: "npm run dev --workspace @personal-assistant/api" }] } };
      return {};
    });
    const runtime = new HerdrRuntime({ environment: { HERDR_WORKSPACE_ID: "w3" }, runCommand });

    expect(runtime.startProcess("npm", ["run", "dev"], "API", {})).toEqual({ paneId: "w3:p5", owned: false });
    runtime.stop();
    expect(runCommand).not.toHaveBeenCalledWith(expect.arrayContaining(["pane", "split"]));
    expect(runCommand).not.toHaveBeenCalledWith(expect.arrayContaining(["pane", "send-text"]));
  });

  test("does not reuse a stale AI pane after readiness failed", () => {
    const commands = [];
    const runCommand = vi.fn((arguments_) => {
      commands.push(arguments_);
      if (arguments_[0] === "tab") return { tabs: [{ tab_id: "w3:t2", label: "run", pane_id: "w3:p4" }] };
      if (arguments_[0] === "pane" && arguments_[1] === "list") return { panes: [{ pane_id: "w3:p6", tab_id: "w3:t2", label: "personal-assistant Whisper :local" }] };
      if (arguments_[0] === "pane" && arguments_[1] === "split") return { pane: { pane_id: "w3:p9" } };
      return {};
    });
    const runtime = new HerdrRuntime({ environment: { HERDR_WORKSPACE_ID: "w3" }, runCommand });

    expect(runtime.startProcess("/tools/whisper-server", ["-m", "/models/model.bin"], "Whisper", {})).toEqual({ paneId: "w3:p9", owned: true });
    expect(commands).toContainEqual(expect.arrayContaining(["pane", "split"]));
    expect(commands).toContainEqual(["pane", "run", "w3:p9", "'/tools/whisper-server' '-m' '/models/model.bin'"]);
  });

  test("lays out a fresh run tab as a 2x2 grid with an Ollama monitor", () => {
    const commands = [];
    const panes = [];
    let hasRunTab = false;
    let nextPane = 7;
    const runCommand = vi.fn((arguments_) => {
      commands.push(arguments_);
      if (arguments_[0] === "tab" && arguments_[1] === "list") return { tabs: hasRunTab ? [{ tab_id: "w3:t3", label: "run" }] : [] };
      if (arguments_[0] === "tab" && arguments_[1] === "create") {
        hasRunTab = true;
        panes.push({ pane_id: "w3:pF", tab_id: "w3:t3" });
        return { tab: { tab_id: "w3:t3", label: "run" } };
      }
      if (arguments_[0] === "pane" && arguments_[1] === "list") return { panes: [...panes] };
      if (arguments_[0] === "pane" && arguments_[1] === "split") {
        const pane = { pane_id: `w3:p${String.fromCharCode(71 + nextPane++ - 7)}` };
        panes.push({ ...pane, tab_id: "w3:t3" });
        return { pane };
      }
      if (arguments_[0] === "pane" && arguments_[1] === "rename") {
        const pane = panes.find((candidate) => candidate.pane_id === arguments_[2]);
        if (pane) pane.label = arguments_[3];
      }
      return {};
    });
    const runtime = new HerdrRuntime({ environment: { HERDR_WORKSPACE_ID: "w3" }, runCommand, cwd: "/repo" });

    runtime.startMonitor("reviewed-model");
    runtime.startProcess("/tools/whisper-server", ["-m", "/models/model.bin"], "Whisper", {});
    runtime.startProcess("npm", ["run", "dev"], "API", { API_PORT: "3000" });
    runtime.startProcess("npm", ["run", "start"], "Expo", {});

    expect(commands).toContainEqual(expect.arrayContaining(["pane", "split", "--pane", "w3:pF", "--direction", "right"]));
    expect(commands).toContainEqual(expect.arrayContaining(["pane", "split", "--pane", "w3:pF", "--direction", "down"]));
    expect(commands).toContainEqual(expect.arrayContaining(["pane", "split", "--pane", "w3:pG", "--direction", "down"]));
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

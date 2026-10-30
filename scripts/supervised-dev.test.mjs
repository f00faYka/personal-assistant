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
  WHISPER_ENDPOINT: "http://127.0.0.1:8080/inference",
  WHISPER_HEALTH_ENDPOINT: "http://127.0.0.1:8080/health",
  WHISPER_MODEL: "ggml-small",
  AI_RUNTIME_MANAGER_PATH: "/tools/ai-runtime-manager",
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
    expect(loadSupervisedConfiguration(validEnvironment)).toMatchObject({ ollamaModel: "reviewed-model", whisperModel: "ggml-small" });

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

  test("lays out only the Personal Assistant API and Expo panes in a fresh run tab", () => {
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

    runtime.startProcess("npm", ["run", "dev"], "API", { API_PORT: "3000" });
    runtime.startProcess("npm", ["run", "start"], "Expo", {});

    expect(commands).toContainEqual(expect.arrayContaining(["pane", "split", "--pane", "w3:pF", "--direction", "right"]));
    expect(commands.filter((command) => command[0] === "pane" && command[1] === "run")).toHaveLength(2);
  });
});

describe("SupervisedDevelopment", () => {
  const readyStatus = (whisperOwnership = "managed", ollamaOwnership = "reused") => ({
    state: "ok",
    runtimes: {
      whisper: { enabled: true, state: "ready", ownership: whisperOwnership },
      ollama: { enabled: true, state: "ready", ownership: ollamaOwnership },
    },
  });

  function managerRunner({ initial = readyStatus(), started = readyStatus(), validationCode = 0, startedCode = 0 } = {}) {
    return vi.fn(async (_executable, arguments_) => {
      if (arguments_[0] === "config") return { code: validationCode, stdout: "valid", stderr: "" };
      if (arguments_[1] === "status") return { code: 0, stdout: JSON.stringify(initial), stderr: "" };
      if (arguments_[1] === "start") return { code: startedCode, stdout: JSON.stringify(started), stderr: "" };
      throw new Error(`Unexpected manager command ${arguments_.join(" ")}`);
    });
  }

  function readyFetch(overrides = {}) {
    return vi.fn(async (url) => {
      if (url.endsWith("tags")) return { ok: true, json: async () => ({ models: [{ name: "reviewed-model" }] }) };
      return { ok: true, json: async () => ({}), ...overrides };
    });
  }

  test("uses managed Whisper and reused Ollama after manager and endpoint readiness checks", async () => {
    const api = child();
    const mobile = child();
    const spawn = vi.fn().mockReturnValueOnce(api).mockReturnValueOnce(mobile);
    const fetch = readyFetch();
    const runManager = managerRunner();
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, runManager, exists: () => true });

    await routine.start();
    await routine.stop();

    expect(runManager.mock.calls.map(([, args]) => args)).toEqual([
      ["config", "validate"], ["--json", "status"], ["--json", "start"],
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8080/health", "http://127.0.0.1:11434/api/tags",
    ]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(api.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mobile.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("allows unavailable runtimes to be started by manager before direct readiness checks", async () => {
    const initial = { state: "ok", runtimes: {
      whisper: { enabled: true, state: "unavailable", ownership: "none" },
      ollama: { enabled: true, state: "unavailable", ownership: "none" },
    } };
    const runManager = managerRunner({ initial, started: readyStatus("managed", "managed") });
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch: readyFetch(), spawn: vi.fn(() => child()), runManager, exists: () => true });

    await routine.start();

    expect(runManager).toHaveBeenCalledTimes(3);
  });

  test("explains conflict and does not start runtimes, API, or Expo", async () => {
    const initial = { state: "ok", runtimes: {
      whisper: { enabled: true, state: "ready", ownership: "managed" },
      ollama: { enabled: true, state: "conflict", ownership: "unknown", reason: "model is not loaded" },
    } };
    const runManager = managerRunner({ initial });
    const spawn = vi.fn(() => child());
    const routine = new SupervisedDevelopment({ environment: validEnvironment, runManager, spawn, exists: () => true });

    await expect(routine.start()).rejects.toThrow(/ollama conflict.*model is not loaded.*ai-runtime-manager status/);
    expect(runManager).toHaveBeenCalledTimes(2);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("explains unavailable runtime when manager cannot start it", async () => {
    const unavailable = { state: "error", runtimes: {
      whisper: { enabled: true, state: "ready", ownership: "managed" },
      ollama: { enabled: true, state: "unavailable", ownership: "none", reason: "configured model is unavailable" },
    } };
    const runManager = managerRunner({ initial: { state: "ok", runtimes: {} }, started: unavailable, startedCode: 2 });
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch: readyFetch(), spawn: vi.fn(), runManager, exists: () => true });

    await expect(routine.start()).rejects.toThrow(/ollama unavailable.*configured model is unavailable.*ai-runtime-manager status/);
  });

  test("does not start the app while another manager start is active", async () => {
    const runManager = managerRunner({ started: { state: "duplicate", runtimes: {} } });
    const spawn = vi.fn();
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch: readyFetch(), spawn, runManager, exists: () => true });

    await expect(routine.start()).rejects.toThrow(/Another AI Runtime Manager start is already in progress/);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("reports a missing CLI or invalid manager config before starting the app", async () => {
    const noCli = new SupervisedDevelopment({ environment: { ...validEnvironment, AI_RUNTIME_MANAGER_PATH: "" }, fetch: readyFetch(), spawn: vi.fn(), exists: () => false });
    await expect(noCli.start()).rejects.toThrow(/AI Runtime Manager CLI not found/);

    const invalidConfig = new SupervisedDevelopment({ environment: validEnvironment, fetch: readyFetch(), spawn: vi.fn(), runManager: managerRunner({ validationCode: 1 }), exists: () => true });
    await expect(invalidConfig.start()).rejects.toThrow(/configuration is invalid or unavailable.*config validate/);
  });

  test("does not spawn API or Expo when a direct configured endpoint or model check fails", async () => {
    const spawn = vi.fn(() => child());
    const fetch = vi.fn(async (url) => url.endsWith("tags")
      ? { ok: true, json: async () => ({ models: [{ name: "another-model" }] }) }
      : ({ ok: true, json: async () => ({}) }));
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch, spawn, runManager: managerRunner(), exists: () => true });

    await expect(routine.start()).rejects.toThrow(/Configured Ollama model reviewed-model is not available/);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("cleans up only API and Expo children, leaving manager-owned runtimes to the manager", async () => {
    const api = child();
    const mobile = child();
    const spawn = vi.fn().mockReturnValueOnce(api).mockReturnValueOnce(mobile);
    const runManager = managerRunner();
    const routine = new SupervisedDevelopment({ environment: validEnvironment, fetch: readyFetch(), spawn, runManager, exists: () => true });

    await routine.start();
    await routine.stop();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(api.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mobile.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runManager.mock.calls.map(([, args]) => args)).not.toContainEqual(["stop"]);
  });
});

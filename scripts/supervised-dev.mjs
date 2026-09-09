import { accessSync, constants, existsSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const REQUIRED = [
  "API_HOST",
  "API_PORT",
  "OLLAMA_ENDPOINT",
  "OLLAMA_HEALTH_ENDPOINT",
  "OLLAMA_MODEL",
  "OLLAMA_BINARY_PATH",
  "WHISPER_ENDPOINT",
  "WHISPER_HEALTH_ENDPOINT",
  "WHISPER_BINARY_PATH",
  "WHISPER_MODEL_PATH",
  "WHISPER_MODEL",
];

export class ConfigurationError extends Error {
  constructor(details) {
    super(`Invalid supervised development configuration:\n${details}`);
    this.name = "ConfigurationError";
  }
}

export function loadSupervisedConfiguration(environment) {
  const missing = REQUIRED.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigurationError(`Missing ${missing.join(", ")}. Copy .env.example to .env and set the local runtime values.`);
  }

  const urls = [
    ["OLLAMA_ENDPOINT", environment.OLLAMA_ENDPOINT],
    ["OLLAMA_HEALTH_ENDPOINT", environment.OLLAMA_HEALTH_ENDPOINT],
    ["WHISPER_ENDPOINT", environment.WHISPER_ENDPOINT],
    ["WHISPER_HEALTH_ENDPOINT", environment.WHISPER_HEALTH_ENDPOINT],
  ];
  const invalidUrls = urls.filter(([, value]) => !isHttpUrl(value));
  if (invalidUrls.length > 0) {
    throw new ConfigurationError(`${invalidUrls.map(([name]) => `${name} must use HTTP or HTTPS`).join("; ")}.`);
  }

  const readinessTimeoutMilliseconds = positiveInteger(environment.SUPERVISOR_READINESS_TIMEOUT_MS, "SUPERVISOR_READINESS_TIMEOUT_MS", 120_000);
  const pollIntervalMilliseconds = positiveInteger(environment.SUPERVISOR_POLL_INTERVAL_MS, "SUPERVISOR_POLL_INTERVAL_MS", 250);
  const apiPort = positiveInteger(environment.API_PORT, "API_PORT", 3_000, 65_535);
  if (!environment.EXPO_PUBLIC_API_BASE_URL?.trim() || !isHttpUrl(environment.EXPO_PUBLIC_API_BASE_URL)) {
    throw new ConfigurationError("EXPO_PUBLIC_API_BASE_URL must use HTTP or HTTPS. Set it in .env (or use --lan to derive it from API_PORT).");
  }

  return {
    ollamaEndpoint: environment.OLLAMA_ENDPOINT,
    ollamaHealthEndpoint: environment.OLLAMA_HEALTH_ENDPOINT,
    ollamaModel: environment.OLLAMA_MODEL,
    ollamaBinaryPath: environment.OLLAMA_BINARY_PATH,
    whisperEndpoint: environment.WHISPER_ENDPOINT,
    whisperHealthEndpoint: environment.WHISPER_HEALTH_ENDPOINT,
    whisperBinaryPath: environment.WHISPER_BINARY_PATH,
    whisperModelPath: environment.WHISPER_MODEL_PATH,
    whisperModel: environment.WHISPER_MODEL,
    readinessTimeoutMilliseconds,
    pollIntervalMilliseconds,
    apiHost: environment.API_HOST,
    apiPort,
    apiBaseUrl: environment.EXPO_PUBLIC_API_BASE_URL,
  };
}

export class SupervisedDevelopment {
  #configuration;
  #fetch;
  #spawn;
  #exists;
  #children = [];
  #stopping = false;
  #started = false;
  #herdr;

  constructor({ environment, fetch = globalThis.fetch, spawn = nodeSpawn, exists = existsSync, herdr } = {}) {
    this.#configuration = loadSupervisedConfiguration(environment);
    this.#fetch = fetch;
    this.#spawn = spawn;
    this.#exists = exists;
    this.#herdr = herdr ?? (isHerdrEnvironment(environment) ? new HerdrRuntime({ environment }) : null);
  }

  async start() {
    if (this.#started) return;
    const ollamaReused = await this.#ensureOllama();
    if (ollamaReused) this.#herdr?.startMonitor(this.#configuration.ollamaModel);
    if (this.#stopping) return;
    await this.#ensureWhisper();
    if (this.#stopping) return;
    this.#startApplicationProcesses();
    this.#started = true;
  }

  async stop() {
    if (this.#stopping) return;
    this.#stopping = true;
    for (const child of [...this.#children].reverse()) child.kill("SIGTERM");
    this.#children = [];
    this.#herdr?.stop();
  }

  #validateWhisperAssets() {
    const missing = [];
    if (!this.#exists(this.#configuration.whisperBinaryPath)) missing.push("WHISPER_BINARY_PATH");
    if (!this.#exists(this.#configuration.whisperModelPath)) missing.push("WHISPER_MODEL_PATH");
    if (missing.length > 0) {
      throw new Error(`Missing ${missing.join(" and ")}. Install the local assets and set the paths in .env; this command never downloads them.`);
    }
    try {
      accessSync(this.#configuration.whisperBinaryPath, constants.X_OK);
    } catch {
      // Test doubles may only implement exists(). The real command still reports a useful path error.
      if (this.#exists === existsSync) throw new Error(`WHISPER_BINARY_PATH is not executable: ${this.#configuration.whisperBinaryPath}`);
    }
  }

  async #ensureOllama() {
    const currentState = await this.#ollamaModelState();
    if (currentState === "ready") return true;
    if (currentState === "missing") throw this.#missingOllamaModelError();
    if (!this.#exists(this.#configuration.ollamaBinaryPath)) {
      throw new Error(`Missing OLLAMA_BINARY_PATH. Install Ollama and set its binary path in .env; this command never downloads it.`);
    }
    this.#startChild(this.#configuration.ollamaBinaryPath, ["serve"], "Ollama");
    await this.#waitFor("Ollama", async () => {
      const state = await this.#ollamaModelState();
      if (state === "missing") throw this.#missingOllamaModelError();
      return state === "ready";
    });
    return false;
  }

  async #ollamaModelState() {
    const response = await this.#request(this.#configuration.ollamaHealthEndpoint);
    if (!response) return "unavailable";
    const body = await response.json();
    return Array.isArray(body.models) && body.models.some((model) => model?.name === this.#configuration.ollamaModel) ? "ready" : "missing";
  }

  #missingOllamaModelError() {
    return new Error(`Configured Ollama model is missing: ${this.#configuration.ollamaModel}. Pull it manually, then rerun; this command never downloads models.`);
  }

  async #ensureWhisper() {
    if (await this.#isReady(this.#configuration.whisperHealthEndpoint)) return;
    this.#validateWhisperAssets();
    const endpoint = new URL(this.#configuration.whisperEndpoint);
    const host = endpoint.hostname;
    const port = endpoint.port || (endpoint.protocol === "https:" ? "443" : "80");
    this.#startChild(this.#configuration.whisperBinaryPath, [
      "-m", this.#configuration.whisperModelPath,
      "--host", host,
      "--port", port,
      "--convert",
    ], "Whisper");
    await this.#waitFor("Whisper", () => this.#isReady(this.#configuration.whisperHealthEndpoint));
  }

  async #isReady(endpoint) {
    return Boolean(await this.#request(endpoint));
  }

  async #request(endpoint) {
    try {
      const response = await this.#fetch(endpoint, { signal: AbortSignal.timeout(this.#configuration.readinessTimeoutMilliseconds) });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  }

  async #waitFor(name, check) {
    const deadline = Date.now() + this.#configuration.readinessTimeoutMilliseconds;
    while (Date.now() <= deadline) {
      if (await check()) return;
      await delay(this.#configuration.pollIntervalMilliseconds);
    }
    throw new Error(`${name} did not become ready within ${this.#configuration.readinessTimeoutMilliseconds}ms. Check the configured endpoint, binary, logs, and local installation.`);
  }

  #startApplicationProcesses() {
    const environment = {
      ...process.env,
      API_HOST: this.#configuration.apiHost,
      API_PORT: String(this.#configuration.apiPort),
      EXPO_PUBLIC_API_BASE_URL: this.#configuration.apiBaseUrl,
    };
    this.#startChild("npm", ["run", "dev", "--workspace", "@personal-assistant/api"], "API", environment);
    this.#startChild("npm", ["run", "start", "--workspace", "@personal-assistant/mobile"], "Expo", environment);
  }

  #startChild(command, arguments_, name, environment = process.env) {
    if (this.#herdr) {
      this.#herdr.startProcess(command, arguments_, name, environment);
      return;
    }
    const child = this.#spawn(command, arguments_, { env: environment, stdio: "inherit" });
    this.#children.push(child);
    child.once?.("exit", (code, signal) => {
      if (!this.#stopping && (code !== 0 || signal !== "SIGTERM")) {
        void this.stop();
        console.error(`${name} exited before supervised development stopped (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      }
    });
    return child;
  }
}

export class HerdrRuntime {
  #environment;
  #runCommand;
  #cwd;
  #ownedPanes = [];
  #freshTab = false;

  constructor({ environment, runCommand = defaultHerdrCommand, cwd = process.cwd() }) {
    this.#environment = environment;
    this.#runCommand = runCommand;
    this.#cwd = cwd;
  }

  startProcess(command, arguments_, name, environment) {
    const tab = this.#runCommand(["tab", "list", "--workspace", this.#environment.HERDR_WORKSPACE_ID]).tabs
      .find((candidate) => candidate.label === "run");
    const targetTab = tab ?? this.#createRunTab();
    const panes = this.#runCommand(["pane", "list", "--workspace", this.#environment.HERDR_WORKSPACE_ID]).panes
      .filter((pane) => pane.tab_id === targetTab.tab_id);
    const labelPrefix = `personal-assistant ${name}`;
    const existing = ["API", "Expo", "Ollama monitor"].includes(name)
      ? panes.find((pane) => pane.label?.startsWith(labelPrefix))
      : undefined;
    if (existing && this.#isActiveRuntimePane(existing, name)) return { paneId: existing.pane_id, owned: false };

    const useFreshTabRoot = this.#freshTab && this.#ownedPanes.length === 0;
    let pane;
    if (useFreshTabRoot) {
      pane = panes[0] ?? (targetTab.pane_id ? { pane_id: targetTab.pane_id } : undefined);
    } else {
      const anchor = this.#layoutAnchor(panes, targetTab);
      if (!anchor) throw new Error("Herdr run tab has no pane to split. Open or recreate the run tab, then retry.");
      const splitArguments = ["pane", "split", "--pane", anchor.paneId, "--direction", anchor.direction, "--cwd", this.#cwd, "--no-focus"];
      for (const [key, value] of Object.entries(environment)) {
        if (!["API_HOST", "API_PORT", "EXPO_PUBLIC_API_BASE_URL"].includes(key)) continue;
        if (value !== undefined) splitArguments.push("--env", `${key}=${value}`);
      }
      pane = this.#runCommand(splitArguments).pane;
    }
    if (!pane?.pane_id) throw new Error(`Herdr did not return the new pane ID for ${name}.`);
    this.#ownedPanes.push(pane.pane_id);
    this.#runCommand(["pane", "run", pane.pane_id, [command, ...arguments_].map(shellQuote).join(" ")]);
    this.#runCommand(["pane", "rename", pane.pane_id, `${labelPrefix} :${this.#portFor(name, environment)}`]);
    return { paneId: pane.pane_id, owned: true };
  }

  stop() {
    for (const paneId of [...this.#ownedPanes].reverse()) {
      this.#runCommand(["pane", "send-text", paneId, "\u0003"]);
    }
    this.#ownedPanes = [];
  }

  startMonitor(model) {
    const monitor = `while true; do clear; printf '%s\\n' 'Ollama monitor'; ollama ps; printf '\\nConfigured model: %s\\n' ${shellQuote(model)}; ollama list | grep -F -- ${shellQuote(model)} || true; sleep 5; done`;
    return this.startProcess("sh", ["-c", monitor], "Ollama monitor", {});
  }

  #createRunTab() {
    const result = this.#runCommand(["tab", "create", "--workspace", this.#environment.HERDR_WORKSPACE_ID, "--cwd", this.#cwd, "--label", "run", "--no-focus"]);
    if (!result.tab?.tab_id) throw new Error("Herdr did not return the new run tab ID.");
    this.#freshTab = true;
    return result.tab;
  }

  #layoutAnchor(panes, targetTab) {
    if (this.#freshTab && this.#ownedPanes.length === 0) return { paneId: panes[0]?.pane_id ?? targetTab.pane_id, direction: "right" };
    const root = this.#ownedPanes[0] ?? panes[0]?.pane_id ?? targetTab.pane_id;
    const topRight = this.#ownedPanes[1];
    if (this.#ownedPanes.length === 1) return { paneId: root, direction: "right" };
    if (this.#ownedPanes.length === 2) return { paneId: root, direction: "down" };
    if (this.#ownedPanes.length === 3 && topRight) return { paneId: topRight, direction: "down" };
    return { paneId: panes.at(-1)?.pane_id ?? root, direction: "down" };
  }

  #portFor(name, environment) {
    if (name === "API") return environment.API_PORT ?? this.#environment.API_PORT ?? "local";
    if (name === "Expo") return environment.EXPO_PORT ?? this.#environment.EXPO_PORT ?? "local";
    return "local";
  }

  #isActiveRuntimePane(pane, name) {
    try {
      const processes = this.#runCommand(["pane", "process-info", "--pane", pane.pane_id]).process_info?.foreground_processes ?? [];
      return processes.some((process) => {
        const commandLine = process.cmdline ?? "";
        if (name === "API") return commandLine.includes("npm run dev") || commandLine.includes("server.ts");
        if (name === "Expo") return commandLine.includes("npm run start") || commandLine.includes("expo start");
        return !commandLine.includes("-zsh") && !commandLine.includes("bash");
      });
    } catch {
      return false;
    }
  }
}

export function isHerdrEnvironment(environment) {
  return environment.HERDR_ENV === "1" && Boolean(environment.HERDR_WORKSPACE_ID);
}

function defaultHerdrCommand(arguments_) {
  const output = execFileSync("herdr", arguments_, { encoding: "utf8" });
  try {
    const envelope = JSON.parse(output);
    return envelope.result ?? envelope;
  } catch {
    if (arguments_[0] === "pane" && ["run", "rename", "send-text"].includes(arguments_[1])) return {};
    throw new Error(`Herdr returned invalid command output for: herdr ${arguments_.join(" ")}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function positiveInteger(value, name, fallback, maximum = 600_000) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new ConfigurationError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

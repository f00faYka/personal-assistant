import { existsSync } from "node:fs";
import { execFile, spawn as nodeSpawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const REQUIRED = [
  "API_HOST",
  "API_PORT",
  "OLLAMA_ENDPOINT",
  "OLLAMA_HEALTH_ENDPOINT",
  "WHISPER_ENDPOINT",
  "WHISPER_HEALTH_ENDPOINT",
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
    whisperEndpoint: environment.WHISPER_ENDPOINT,
    whisperHealthEndpoint: environment.WHISPER_HEALTH_ENDPOINT,
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
  #runManager;
  #managerPath;
  #selectedOllamaModel;
  #children = [];
  #stopping = false;
  #started = false;
  #herdr;

  constructor({ environment, fetch = globalThis.fetch, spawn = nodeSpawn, exists = existsSync, runManager = executeManager, herdr } = {}) {
    this.#configuration = loadSupervisedConfiguration(environment);
    this.#fetch = fetch;
    this.#spawn = spawn;
    this.#runManager = runManager;
    this.#managerPath = resolveManagerPath(environment, exists);
    this.#herdr = herdr ?? (isHerdrEnvironment(environment) ? new HerdrRuntime({ environment }) : null);
  }

  async start() {
    if (this.#started) return;
    await this.#ensureManagerRuntimes();
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

  async #ensureManagerRuntimes() {
    if (!this.#managerPath) {
      throw new Error(`AI Runtime Manager CLI not found. Install it and make ai-runtime-manager available in PATH or at ${path.join(homedir(), ".local/bin/ai-runtime-manager")}; then run: ai-runtime-manager config validate`);
    }

    const validation = await this.#runManager(this.#managerPath, ["config", "validate"]);
    if (validation.code !== 0) {
      throw new Error(`AI Runtime Manager configuration is invalid or unavailable. Run "ai-runtime-manager config validate" and resolve the reported issue. ${validation.stderr || validation.stdout}`.trim());
    }

    const statusResult = await this.#runManager(this.#managerPath, ["--json", "status"]);
    const status = parseManagerResult(statusResult, "status");
    if (!status.runtimes || typeof status.runtimes !== "object") {
      throw new Error(`AI Runtime Manager status has no runtime records. Run "ai-runtime-manager status" and inspect its output.`);
    }
    for (const [runtime, value] of Object.entries(status.runtimes)) {
      if (value.state === "conflict" || value.state === "failed") {
        throw managerStateError(runtime, value, this.#configuration);
      }
    }
    this.#selectedOllamaModel = managerModel(status.runtimes.ollama, "status");

    const startResult = await this.#runManager(this.#managerPath, ["--json", "start"]);
    const started = parseManagerResult(startResult, "start");
    if (started.state === "duplicate") {
      throw new Error(`Another AI Runtime Manager start is already in progress. Wait for it, then run "ai-runtime-manager status" before restarting Personal Assistant.`);
    }
    if (started.state !== "ok") {
      const issue = Object.entries(started.runtimes ?? {}).find(([, value]) => value.state !== "ready");
      if (issue) throw managerStateError(issue[0], issue[1], this.#configuration, true);
      throw new Error(`AI Runtime Manager could not start configured runtimes. Run "ai-runtime-manager status" for details.`);
    }
    const startedOllamaModel = managerModel(started.runtimes?.ollama, "start");
    if (startedOllamaModel !== this.#selectedOllamaModel) {
      throw new Error(`AI Runtime Manager reported different Ollama models during status and start (${this.#selectedOllamaModel} and ${startedOllamaModel}). Check its configuration and retry.`);
    }
    for (const [runtime, value] of Object.entries(started.runtimes ?? {})) {
      if (value.enabled && (value.state !== "ready" || !["managed", "reused"].includes(value.ownership))) {
        throw managerStateError(runtime, value, this.#configuration, true);
      }
    }

    await this.#waitFor("Whisper", () => this.#isReady(this.#configuration.whisperHealthEndpoint));
    await this.#waitForOllama();
  }

  async #waitForOllama() {
    const deadline = Date.now() + this.#configuration.readinessTimeoutMilliseconds;
    while (Date.now() <= deadline) {
      const state = await this.#ollamaModelState();
      if (state === "ready") return;
      if (state === "missing") {
        throw new Error(`AI Runtime Manager's Ollama model ${this.#selectedOllamaModel} is not available at ${this.#configuration.ollamaHealthEndpoint}. Check "ai-runtime-manager status"; Personal Assistant does not select or download models.`);
      }
      await delay(this.#configuration.pollIntervalMilliseconds);
    }
    throw new Error(`Ollama did not become ready at ${this.#configuration.ollamaHealthEndpoint} within ${this.#configuration.readinessTimeoutMilliseconds}ms. Check "ai-runtime-manager status" and the configured endpoint.`);
  }

  async #ollamaModelState() {
    const response = await this.#request(this.#configuration.ollamaHealthEndpoint);
    if (!response) return "unavailable";
    const body = await response.json();
    return Array.isArray(body.models) && body.models.some((model) => model?.name === this.#selectedOllamaModel) ? "ready" : "missing";
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
    throw new Error(`${name} did not become ready within ${this.#configuration.readinessTimeoutMilliseconds}ms. Check "ai-runtime-manager status" and the configured endpoint.`);
  }

  #startApplicationProcesses() {
    const commonEnvironment = {
      ...process.env,
      API_HOST: this.#configuration.apiHost,
      API_PORT: String(this.#configuration.apiPort),
      EXPO_PUBLIC_API_BASE_URL: this.#configuration.apiBaseUrl,
    };
    const apiEnvironment = { ...commonEnvironment, OLLAMA_MODEL: this.#selectedOllamaModel };
    const expoEnvironment = { ...commonEnvironment };
    delete expoEnvironment.OLLAMA_MODEL;
    this.#startChild("npm", ["run", "dev", "--workspace", "@personal-assistant/api"], "API", apiEnvironment);
    this.#startChild("npm", ["run", "start", "--workspace", "@personal-assistant/mobile"], "Expo", expoEnvironment);
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

const execFileAsync = promisify(execFile);

async function executeManager(executable, arguments_) {
  try {
    const result = await execFileAsync(executable, arguments_, { encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
  }
}

function resolveManagerPath(environment, exists) {
  if (environment.AI_RUNTIME_MANAGER_PATH?.trim()) return environment.AI_RUNTIME_MANAGER_PATH;
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "ai-runtime-manager");
    if (exists(candidate)) return candidate;
  }
  const localCandidate = path.join(homedir(), ".local/bin/ai-runtime-manager");
  return exists(localCandidate) ? localCandidate : null;
}

function parseManagerResult(result, command) {
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // The CLI may have printed an operator-facing message instead of JSON.
  }
  if (parsed && typeof parsed === "object" && (result.code === 0 || command === "start")) return parsed;
  if (result.code !== 0) {
    throw new Error(`AI Runtime Manager ${command} failed. Run "ai-runtime-manager ${command === "status" ? "status" : "config validate"}" and resolve the reported issue. ${result.stderr || result.stdout}`.trim());
  }
  throw new Error(`AI Runtime Manager ${command} returned an unreadable status. Run "ai-runtime-manager status" and inspect its output.`);
}

function managerStateError(runtime, value, configuration, afterStart = false) {
  const endpoint = runtime === "whisper" ? configuration.whisperEndpoint : configuration.ollamaEndpoint;
  const model = runtime === "ollama" && value.model ? ` Manager-selected model: ${value.model}.` : "";
  const reason = value.reason ? ` ${value.reason}` : "";
  const instruction = value.state === "conflict"
    ? runtime === "ollama" && /model/i.test(value.reason ?? "")
      ? `Check "ai-runtime-manager status" and the manager configuration. If resolving the model state requires loading or downloading it, make that a separate operator decision.`
      : `Resolve the port/process conflict manually, then check "ai-runtime-manager status".`
    : value.state === "unavailable"
      ? afterStart
        ? `The manager could not make it ready. Check "ai-runtime-manager status" and resolve missing local runtime/model assets or configuration manually.`
        : `Start it with "ai-runtime-manager start", then verify "ai-runtime-manager status".`
      : `Check "ai-runtime-manager config validate" and "ai-runtime-manager status".`;
  return new Error(`AI Runtime Manager reports ${runtime} ${value.state}${value.ownership ? ` (${value.ownership})` : ""}.${model}${reason} Personal Assistant expects ${endpoint}. ${instruction} Personal Assistant does not directly start or stop runtime processes; their lifecycle belongs to the manager.`);
}

function managerModel(runtime, command) {
  if (typeof runtime?.model !== "string" || !runtime.model.trim()) {
    throw new Error(`AI Runtime Manager ${command} did not report its selected Ollama model. Check "ai-runtime-manager config validate" and "ai-runtime-manager status".`);
  }
  return runtime.model;
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
    const existing = ["API", "Expo"].includes(name)
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

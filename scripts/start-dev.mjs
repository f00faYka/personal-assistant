import { networkInterfaces } from "node:os";
import { loadEnvFile } from "node:process";

import { isHerdrEnvironment, SupervisedDevelopment } from "./supervised-dev.mjs";

try {
  loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

if (process.argv.includes("--lan")) {
  process.env.API_HOST = "0.0.0.0";
  if (process.env.EXPO_PUBLIC_API_BASE_URL) {
    // Keep the explicitly configured phone URL and only widen the API bind address.
  } else {
    const port = process.env.API_PORT;
    if (!port) throw new Error("Set EXPO_PUBLIC_API_BASE_URL or API_PORT before using --lan.");
    process.env.EXPO_PUBLIC_API_BASE_URL = `http://${findLanAddress()}:${port}`;
  }
}

const routine = new SupervisedDevelopment({ environment: process.env });
const herdrMode = isHerdrEnvironment(process.env);
let keepAlive;
let releaseLauncher;
const launcherStopped = new Promise((resolve) => { releaseLauncher = resolve; });
console.log("Supervising local Ollama and Whisper, then starting API and Expo. Press Ctrl+C to stop owned processes.\n");

if (herdrMode) keepAlive = setInterval(() => {}, 60_000);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  void routine.stop().finally(() => {
    if (keepAlive) clearInterval(keepAlive);
    releaseLauncher();
  });
});

try {
  await routine.start();
  if (herdrMode) await launcherStopped;
} catch (error) {
  await routine.stop();
  if (keepAlive) clearInterval(keepAlive);
  releaseLauncher();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function findLanAddress() {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) return address.address;
    }
  }
  throw new Error("Could not determine a LAN IPv4 address. Set EXPO_PUBLIC_API_BASE_URL explicitly.");
}

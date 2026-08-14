import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const useLan = process.argv.includes("--lan");
const apiPort = process.env.API_PORT ?? "3000";
const apiHost = useLan ? "0.0.0.0" : (process.env.API_HOST ?? "127.0.0.1");
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? `http://${useLan ? findLanAddress() : "127.0.0.1"}:${apiPort}`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const environment = { ...process.env, API_HOST: apiHost, EXPO_PUBLIC_API_BASE_URL: apiBaseUrl };

console.log(`API:    ${apiBaseUrl}`);
console.log(`Binding API to ${apiHost}:${apiPort}`);
console.log("Starting API and Expo. Press Ctrl+C to stop both.\n");

const api = spawn(npmCommand, ["run", "dev", "--workspace", "@personal-assistant/api"], { env: environment, stdio: "inherit" });
const mobile = spawn(npmCommand, ["run", "start", "--workspace", "@personal-assistant/mobile"], { env: environment, stdio: "inherit" });
const children = [api, mobile];
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", stop);

function findLanAddress() {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) return address.address;
    }
  }
  throw new Error("Could not determine a LAN IPv4 address. Set EXPO_PUBLIC_API_BASE_URL explicitly.");
}

import { loadConfiguration, loadLocalEnvironment } from "./configuration.js";
import { buildApi } from "./http/build-api.js";
import { prepareRuntime } from "./runtime.js";

async function start(): Promise<void> {
  loadLocalEnvironment();
  const configuration = loadConfiguration(process.env);
  await prepareRuntime(configuration);

  const application = buildApi({ logger: true });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void application.close();
    });
  }

  await application.listen({
    host: configuration.host,
    port: configuration.port,
  });
}

try {
  await start();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

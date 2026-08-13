import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { CaptureService } from "../features/captures/capture.js";
import { registerCaptureRoutes } from "../features/captures/capture-routes.js";

export interface BuildApiOptions extends FastifyServerOptions {
  readonly captureService?: CaptureService;
}

export function buildApi(options: BuildApiOptions = {}): FastifyInstance {
  const application = Fastify(options);

  application.get("/health", async () => ({ status: "ok" }));

  if (options.captureService) {
    registerCaptureRoutes(application, options.captureService);
  }

  return application;
}

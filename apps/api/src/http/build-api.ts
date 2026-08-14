import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { CaptureService } from "../features/captures/capture.js";
import { registerCaptureRoutes } from "../features/captures/capture-routes.js";
import type { ReviewService } from "../features/reviews/review.js";
import { registerReviewRoutes } from "../features/reviews/review-routes.js";

export interface BuildApiOptions extends FastifyServerOptions {
  readonly captureService?: CaptureService;
  readonly reviewService?: ReviewService;
}

export function buildApi(options: BuildApiOptions = {}): FastifyInstance {
  const application = Fastify(options);

  application.get("/health", async () => ({ status: "ok" }));

  if (options.captureService) {
    registerCaptureRoutes(application, options.captureService);
  }
  if (options.reviewService) {
    registerReviewRoutes(application, options.reviewService);
  }

  return application;
}

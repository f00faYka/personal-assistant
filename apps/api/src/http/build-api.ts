import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { CaptureService, CaptureStoredHandler } from "../features/captures/capture.js";
import type { NoteService, TaskService } from "../features/outcomes/outcome.js";
import { registerOutcomeRoutes } from "../features/outcomes/outcome-routes.js";
import { registerTaskRoutes } from "../features/outcomes/task-routes.js";
import { registerCaptureRoutes } from "../features/captures/capture-routes.js";
import type { ReviewService } from "../features/reviews/review.js";
import { registerReviewRoutes } from "../features/reviews/review-routes.js";
import type { MemberItemsService } from "../features/items/items.js";
import { registerItemRoutes } from "../features/items/item-routes.js";
import type { OfflineDraftService } from "../features/offline-drafts/offline-draft.js";
import { registerOfflineDraftRoutes } from "../features/offline-drafts/offline-draft-routes.js";
import type { SpaceService } from "../features/spaces/space.js";
import { registerSpaceRoutes } from "../features/spaces/space-routes.js";

export interface BuildApiOptions extends FastifyServerOptions {
  readonly captureService?: CaptureService;
  readonly captureStoredHandler?: CaptureStoredHandler;
  readonly reviewService?: ReviewService;
  readonly noteService?: NoteService;
  readonly taskService?: TaskService;
  readonly memberItemsService?: MemberItemsService;
  readonly offlineDraftService?: OfflineDraftService;
  readonly spaceService?: SpaceService;
}

export function buildApi(options: BuildApiOptions = {}): FastifyInstance {
  const application = Fastify(options);

  application.get("/health", async () => ({ status: "ok" }));

  if (options.captureService) {
    registerCaptureRoutes(application, options.captureService, options.captureStoredHandler);
  }
  if (options.reviewService) {
    registerReviewRoutes(application, options.reviewService);
  }
  if (options.noteService) registerOutcomeRoutes(application, options.noteService, options.reviewService);
  if (options.taskService) registerTaskRoutes(application, options.taskService);
  if (options.memberItemsService) registerItemRoutes(application, options.memberItemsService);
  if (options.offlineDraftService) registerOfflineDraftRoutes(application, options.offlineDraftService);
  if (options.spaceService) registerSpaceRoutes(application, options.spaceService);

  return application;
}

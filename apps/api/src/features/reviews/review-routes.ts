import type { FastifyInstance } from "fastify";

import { CaptureNotFoundError } from "../captures/capture.js";
import { ReviewService } from "./review.js";

export function registerReviewRoutes(application: FastifyInstance, service: ReviewService): void {
  application.get<{ Params: { id: string } }>("/captures/:id/review", async (request, reply) => {
    try {
      return { review: service.get(request.params.id) };
    } catch (error) {
      if (error instanceof CaptureNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });
}
